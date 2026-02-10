import { useEffect } from 'react';
import { AppState } from 'react-native';
import { websocketService, WebSocketMessage } from '../services/websocket';
import { webrtcService } from '../services/webrtcService';
import { callNotificationService } from '../services/callNotificationService';
import { useCallStore } from '../store/callStore';
import { useAuthStore } from '../store/authStore';
import { useToast } from './Toast';
import { CallActionEvent } from '../types/native';

/**
 * CallManager - Handles WebRTC signaling coordination
 * Listens to WebSocket messages and coordinates with WebRTC service
 */
export function CallManager() {
  const { user } = useAuthStore();
  const toast = useToast();

  // Handle call action events from native notification (accept/reject from lock screen)
  useEffect(() => {
    const removeCallActionListener = callNotificationService.addCallActionListener(
      async (event: CallActionEvent) => {
        console.log('[CallManager] Call action from notification:', event);
        const callStore = useCallStore.getState();

        if (event.action === 'accept') {
          // If we have a pending call in ringing state, accept it
          if (callStore.status === 'ringing') {
            console.log('[CallManager] Accepting call from notification');
            callStore.setCallStatus('calling');

            if (callStore.isGroupCall) {
              const participants = callStore.getAllParticipants();
              const participantIds = participants.map((p: any) => p.userId);
              await webrtcService.startGroupCall(participantIds);
            } else {
              // Try to get offer from event payload (if passed from native) or store
              let offer = callStore.offer;

              if (!offer && event.payload) {
                try {
                  const payloadObj = JSON.parse(event.payload);
                  if (payloadObj.offer) {
                    console.log('[CallManager] Retrieved offer from event payload');
                    offer = payloadObj.offer;
                    // Update store with this offer so it's available
                    callStore.setOffer(offer);
                  }
                } catch (e) {
                  console.error('[CallManager] Failed to parse payload from event', e);
                }
              }

              if (offer) {
                await webrtcService.answerCall(callStore.callType, offer);
              } else {
                console.error('[CallManager] Cannot answer call - no offer available');
                // Optionally show error to user
                toast.show('Call failed: No connection offer', 'error');
                callStore.endCall();
              }
            }
          }
        } else if (event.action === 'reject') {
          console.log('[CallManager] Rejecting call from notification');
          if (callStore.isGroupCall) {
            webrtcService.endGroupCall();
          } else {
            webrtcService.rejectCall();
          }
        } else if (event.action === 'missed') {
          console.log('[CallManager] Call missed (timeout)');
          if (callStore.status === 'ringing') {
            callStore.endCall();
          }
        }
      }
    );

    return () => {
      removeCallActionListener();
    };
  }, []);

  useEffect(() => {
    console.log('[CallManager] Setting up WebRTC signaling handlers');

    // Buffer for offers that arrive before incoming_call
    const pendingOffers = new Map<string, any>();

    const removeHandler = websocketService.addMessageHandler(async (message: WebSocketMessage) => {
      try {
        // Get fresh state on each message
        const callStore = useCallStore.getState();
        const currentUser = useAuthStore.getState().user;

        console.log('[CallManager] 📨 Received message type:', message.type);
        switch (message.type) {
          case 'incoming_call': {
            console.log('[CallManager] Incoming 1-on-1 call received');
            const payload = message.payload || message;
            const { callId, callType, fromUserId, fromUserName, conversationId } = payload as any;

            console.log('[CallManager] Incoming call details:', {
              callId,
              callType,
              fromUserId,
              fromUserName,
              conversationId,
              currentStatus: callStore.status
            });

            // Ignore calls from ourselves
            if (fromUserId === currentUser?.id) {
              console.log('[CallManager] Ignoring incoming_call from self');
              break;
            }

            // Only handle if not already in a call
            if (callStore.status === 'idle') {
              console.log('[CallManager] Setting up incoming call');

              // Check if we already received an offer for this callId
              const pendingOffer = pendingOffers.get(callId);
              if (pendingOffer) {
                console.log('[CallManager] 🎯 Found pending offer that arrived before incoming_call!');
                pendingOffers.delete(callId); // Remove from buffer
              }

              // Set up the call with caller information
              callStore.receiveCall({
                callId,
                callType: callType || 'audio',
                callerUserId: fromUserId,
                callerName: fromUserName || `User ${fromUserId}`,
                conversationId,
                offer: pendingOffer || (payload as any).offer || null,
              });

              if (pendingOffer) {
                console.log('[CallManager] ✅ Call ready with buffered offer!');

                // Show notification if app is in background (same logic as webrtc_offer handler)
                if (AppState.currentState !== 'active') {
                  console.log('[CallManager] App in background, showing native notification for buffered offer');
                  callNotificationService.showIncomingCallNotification({
                    callId,
                    callerId: String(fromUserId),
                    callerName: fromUserName || 'Unknown',
                    callType: callType || 'audio',
                    isGroupCall: false,
                  });

                  // Set timeout to auto-reset if notification not answered (35 seconds)
                  setTimeout(() => {
                    const currentState = useCallStore.getState();
                    if (currentState.callId === callId && currentState.status === 'ringing') {
                      console.log('[CallManager] ⏱️ Notification timed out (buffered offer case), resetting call state');
                      callStore.reset();
                    }
                  }, 35000);
                }
              } else {
                console.log('[CallManager] ✅ Call metadata stored, waiting for offer');
              }
            } else {
              console.log('[CallManager] ⚠️ Already in a call, ignoring incoming_call');
              // Send busy signal
              websocketService.send({
                type: 'reject_call',
                payload: {
                  callId,
                  toUserId: fromUserId,
                  reason: 'busy'
                }
              });
            }
            break;
          }

          case 'webrtc_offer': {
            console.log('[CallManager] Received WebRTC offer');

            // Handle both message structures
            const payload = message.payload || message;

            const callId = payload.callId;
            const offer = payload.offer;
            const callType = payload.callType;
            const conversationId = payload.conversationId;

            console.log('[CallManager] Offer SDP received for callId:', callId);
            console.log('[CallManager] Current call status:', callStore.status);
            console.log('[CallManager] Current callId in store:', callStore.callId);
            console.log('[CallManager] CallId match:', callStore.callId === callId);
            console.log('[CallManager] Has offer in store before:', !!callStore.offer);

            // Validate required fields
            if (!callId || !offer) {
              console.error('[CallManager] ❌ Invalid offer - missing callId or offer:', {
                hasCallId: !!callId,
                hasOffer: !!offer
              });
              break;
            }

            // Check if this offer is for an existing ringing call
            if (callStore.status === 'ringing' && callStore.callId === callId) {
              console.log('[CallManager] ✅ Adding offer to existing ringing call');

              // Update the call store with the offer
              callStore.setOffer(offer);

              // Update callType if provided
              if (callType) {
                callStore.setCallType(callType);
              }

              console.log('[CallManager] ✅ Offer added, call ready for user response');
              console.log('[CallManager] Has offer in store after setOffer:', !!useCallStore.getState().offer);

              // Show native notification if app is in background
              if (AppState.currentState !== 'active') {
                console.log('[CallManager] App in background, showing native notification');
                callNotificationService.showIncomingCallNotification({
                  callId,
                  callerId: String(callStore.callerUserId),
                  callerName: callStore.callerName || 'Unknown',
                  callType: callType || 'audio',
                  isGroupCall: false,
                });

                // Set timeout to auto-reset if notification not answered (35 seconds)
                // This fixes the issue where second background calls fail because state wasn't reset
                setTimeout(() => {
                  const currentState = useCallStore.getState();
                  if (currentState.callId === callId && currentState.status === 'ringing') {
                    console.log('[CallManager] ⏱️ Notification timed out, resetting call state');
                    callStore.reset();
                  }
                }, 35000); // 35 seconds (Android notification timeout is 30s)
              }
            } else if (callStore.status === 'idle') {
              // webrtc_offer arrived before incoming_call
              // Buffer it and let incoming_call set up the call state to avoid race condition
              console.warn('[CallManager] ⚠️ Received webrtc_offer before incoming_call - buffering');
              pendingOffers.set(callId, offer);
              console.log('[CallManager] Offer buffered for callId:', callId);
            } else {
              console.log('[CallManager] ⚠️ Unexpected state - received offer for callId:', callId, 'but current status is:', callStore.status, 'with callId:', callStore.callId);
            }
            break;
          }

          case 'webrtc_answer': {
            console.log('[CallManager] 📥 Received WebRTC answer');
            console.log('[CallManager] Current call status:', callStore.status);
            console.log('[CallManager] Current callId:', callStore.callId);

            // Handle both message structures
            const payload = message.payload || message;
            const { answer } = payload as any;
            console.log('[CallManager] Extracted answer:', answer);

            // Process answer if call is in calling or active state
            // (active state can happen if call_accepted arrives before webrtc_answer)
            if (callStore.status === 'calling' || callStore.status === 'active') {
              console.log('[CallManager] ✅ Processing WebRTC answer');
              await webrtcService.handleAnswer(answer);
            } else {
              console.warn('[CallManager] ⚠️ Not processing answer - status is:', callStore.status);
            }
            break;
          }

          case 'webrtc_ice_candidate': {
            console.log('[CallManager] Received ICE candidate');

            // Handle different message structures
            // Structure 1: { type, payload: { callId, candidate } }
            // Structure 2: { type, callId, candidate } (what server sends)
            const candidate = message.payload?.candidate || (message as any).candidate;

            if (!candidate) {
              console.error('[CallManager] ❌ No candidate found!');
              console.error('[CallManager] Message:', JSON.stringify(message, null, 2));
              break;
            }

            console.log('[CallManager] Processing ICE candidate');
            await webrtcService.handleIceCandidate(candidate);
            break;
          }

          case 'call_accepted': {
            console.log('[CallManager] 🎉 Call accepted by remote peer!');
            console.log('[CallManager] Updating status to active');
            // Change status from "calling" to "active"
            if (callStore.status === 'calling') {
              callStore.setCallStatus('active');
            }
            break;
          }

          case 'end_call':
          case 'call_ended': {
            console.log('[CallManager] Call ended by remote peer');
            if (callStore.isGroupCall) {
              webrtcService.endGroupCall();
            } else {
              webrtcService.endCall();
            }
            break;
          }

          case 'call_rejected': {
            console.log('[CallManager] Call rejected by remote peer');
            toast.show('Call was declined', 'info');
            if (callStore.isGroupCall) {
              webrtcService.endGroupCall();
            } else {
              webrtcService.endCall();
            }
            break;
          }

          case 'call_failed': {
            console.log('[CallManager] Call failed');
            const payload = message.payload || message;
            const { reason, message: errorMessage } = payload as any;

            if (reason === 'user_busy') {
              toast.show(errorMessage || 'User is currently on another call', 'warning');
            } else {
              toast.show(errorMessage || 'Call failed', 'error');
            }
            if (callStore.isGroupCall) {
              webrtcService.endGroupCall();
            } else {
              webrtcService.endCall();
            }
            break;
          }

          // Group call handlers
          case 'initiate_call': {
            // Only handle group call invitations here; 1:1 calls are handled by incoming_call
            const payload = message.payload || message;
            const { callId, callType, fromUserId, fromUserName, conversationId, isGroupCall, groupName, participants } = payload as any;

            console.log('[CallManager] Initiate call received:', {
              callId,
              callType,
              isGroupCall,
              groupName,
              participantsCount: participants?.length,
              fromUserId,
              fromUserName,
              conversationId
            });

            // Ignore initiate_call messages from ourselves (echoed back from server)
            if (fromUserId === currentUser?.id) {
              console.log('[CallManager] Ignoring initiate_call from self');
              break;
            }

            // Only handle group call invitations; 1:1 calls use incoming_call
            if (isGroupCall && participants) {
              console.log('[CallManager] Received group call invitation');

              callStore.receiveGroupCall({
                callId,
                callType: callType || 'audio',
                callerUserId: fromUserId,
                conversationId,
                groupName: groupName || 'Group Call',
                participants: participants.map((p: any) => ({
                  userId: p.userId || p,
                  userName: p.callsign || p.userName || `User ${p.userId || p}`
                }))
              });
            } else {
              // Ignore 1:1 initiate_call - handled by incoming_call to avoid duplicates
              console.log('[CallManager] Ignoring 1:1 initiate_call (handled by incoming_call)');
            }
            break;
          }

          case 'incoming_group_call': {
            console.log('[CallManager] Incoming group call received');
            const payload = message.payload || message;
            const { callId, groupId, groupName, callType, fromUserId, fromUserName } = payload as any;

            console.log('[CallManager] Incoming group call details:', {
              callId,
              groupId,
              groupName,
              callType,
              fromUserId,
              fromUserName,
              currentStatus: callStore.status
            });

            // Only handle if not already in a call
            if (callStore.status === 'idle') {
              console.log('[CallManager] Setting up incoming group call with caller:', fromUserId);
              // Get group members to build participants list
              // For now, we'll create a minimal participant list with the caller
              callStore.receiveGroupCall({
                callId,
                callType: callType || 'audio',
                callerUserId: fromUserId,
                conversationId: groupId,
                groupName: groupName || 'Group Call',
                participants: [{
                  userId: fromUserId,
                  userName: fromUserName || `User ${fromUserId}`
                }]
              });
              console.log('[CallManager] ✅ Group call set to ringing status, participants:', [{
                userId: fromUserId,
                userName: fromUserName || `User ${fromUserId}`
              }]);

              // Show native notification if app is in background
              if (AppState.currentState !== 'active') {
                console.log('[CallManager] App in background, showing native notification for group call');
                callNotificationService.showIncomingCallNotification({
                  callId,
                  callerId: String(fromUserId),
                  callerName: groupName || 'Group Call',
                  callType: callType || 'audio',
                  isGroupCall: true,
                });
              }
            } else {
              console.log('[CallManager] ⚠️ Already in a call (status:', callStore.status, '), ignoring incoming group call');
              if (callStore.isGroupCall) {
                // If we are already in a group call, and another group call comes in,
                // we should try to join the new one if it's the same group, or reject if different.
                // For now, let's assume we want to join if possible, or reject.
                // This logic might need refinement based on specific requirements.
                console.log('[CallManager] Already in a group call, attempting to join new group call if applicable.');
                // This part is speculative, assuming a scenario where joining is desired.
                // If the intent is to always reject, the original logic is fine.
                // For now, let's just reject to avoid complex state management.
                websocketService.send({
                  type: 'reject_group_call',
                  payload: {
                    callId,
                    groupId,
                    fromUserId: currentUser?.id,
                    userName: currentUser?.callsign || currentUser?.fullName
                  }
                });
              } else {
                // If already in a 1-on-1 call, reject the incoming group call
                websocketService.send({
                  type: 'reject_group_call',
                  payload: {
                    callId,
                    groupId,
                    fromUserId: currentUser?.id,
                    userName: currentUser?.callsign || currentUser?.fullName
                  }
                });
              }
            }
            break;
          }

          case 'join_group_call': {
            console.log('[CallManager] Join group call message received');
            const payload = message.payload || message;
            const { callId, participants, groupName } = payload as any;

            // Add participants to call store if not already added
            if (participants && Array.isArray(participants)) {
              participants.forEach((participant: any) => {
                if (participant.userId !== currentUser?.id) {
                  callStore.addParticipant(
                    participant.userId,
                    participant.callsign || participant.userName || `User ${participant.userId}`
                  );
                }
              });
            }
            break;
          }

          case 'group_call_participants_update': {
            console.log('[CallManager] Group call participants update received');
            const payload = message.payload || message;
            const { callId, participants, participantData, newParticipant } = payload as any;

            console.log('[CallManager] Participants update:', {
              callId,
              participantsCount: Array.isArray(participants) ? participants.length : 0,
              hasParticipantData: !!participantData,
              newParticipant
            });

            // Build a name lookup from participantData (server-resolved names)
            const nameMap = new Map<number, string>();
            if (participantData && Array.isArray(participantData)) {
              participantData.forEach((pd: any) => {
                if (pd.userId && pd.userName) {
                  nameMap.set(pd.userId, pd.userName);
                }
              });
            }

            // Update participants in call store
            if (participants && Array.isArray(participants)) {
              // participants can be an array of IDs or objects with userId
              participants.forEach((participant: any) => {
                const participantId = typeof participant === 'number' ? participant : participant.userId;
                // Prefer server-resolved name from participantData, then from inline data
                const participantName = nameMap.get(participantId)
                  || (typeof participant === 'object'
                    ? (participant.callsign || participant.userName || `User ${participantId}`)
                    : `User ${participantId}`);

                if (participantId && participantId !== currentUser?.id) {
                  // Check if participant already exists
                  const existing = callStore.getParticipant(participantId);
                  if (!existing) {
                    console.log('[CallManager] Adding new participant:', participantId);
                    callStore.addParticipant(participantId, participantName);
                  }
                }
              });
            }

            break;
          }

          case 'group_webrtc_offer': {
            console.log('[CallManager] Group WebRTC offer received');
            const payload = message.payload || message;
            const { fromUserId, offer } = payload as any;

            console.log('[CallManager] Processing group offer from:', fromUserId);
            await webrtcService.handleGroupOffer(fromUserId, offer);
            break;
          }

          case 'group_webrtc_answer': {
            console.log('[CallManager] Group WebRTC answer received');
            const payload = message.payload || message;
            const { fromUserId, answer } = payload as any;

            console.log('[CallManager] Processing group answer from:', fromUserId);
            await webrtcService.handleGroupAnswer(fromUserId, answer);
            break;
          }

          case 'group_webrtc_ice_candidate': {
            console.log('[CallManager] Group WebRTC ICE candidate received');
            const payload = message.payload || message;
            const { fromUserId, candidate } = payload as any;

            console.log('[CallManager] Processing group ICE candidate from:', fromUserId);
            await webrtcService.handleGroupIceCandidate(fromUserId, candidate);
            break;
          }

          case 'initiate_group_webrtc': {
            console.log('[CallManager] 🚀 Initiate group WebRTC received');
            const payload = message.payload || message;
            const { participants, callId } = payload as any;

            console.log('[CallManager] Initiate WebRTC details:', {
              callId,
              participantsCount: participants?.length,
              participants,
              currentUserId: currentUser?.id,
              currentCallStatus: callStore.status
            });

            // Create offers to all other participants (excluding ourselves)
            // BUT FIRST: Wait for local stream to be ready (getUserMedia might still be in progress)
            if (participants && Array.isArray(participants)) {
              console.log('[CallManager] Processing', participants.length, 'participants');
              console.log('[CallManager] Waiting for local stream to be ready...');

              // Wait for local stream (max 5 seconds)
              let localStream = callStore.localStream;
              let attempts = 0;
              while (!localStream && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
                localStream = useCallStore.getState().localStream;
                attempts++;
              }

              if (!localStream) {
                console.error('[CallManager] ❌ Local stream not available after 5 seconds, cannot create offers');
                break;
              }

              console.log('[CallManager] ✅ Local stream ready, creating offers for', participants.length, 'participants');

              // Get unique participant IDs (remove duplicates)
              const uniqueParticipants = [...new Set(participants.map((p: any) => p.userId || p))];
              console.log('[CallManager] Unique participants:', uniqueParticipants);

              for (const participantId of uniqueParticipants) {
                console.log('[CallManager] Checking participant:', participantId, 'vs current user:', currentUser?.id);
                if (participantId !== currentUser?.id) {
                  console.log('[CallManager] ✅ Creating offer to participant:', participantId);
                  await webrtcService.createGroupOffer(participantId);
                } else {
                  console.log('[CallManager] ⏭️ Skipping self (participant', participantId, ')');
                }
              }
              console.log('[CallManager] ✅ Finished processing all participants');
            } else {
              console.log('[CallManager] ⚠️ No participants array or not an array:', participants);
            }
            break;
          }

          case 'participant_joined': {
            console.log('[CallManager] New participant joined group call');
            const payload = message.payload || message;
            const { userId, userName, callsign } = payload as any;

            // Add participant to store
            callStore.addParticipant(userId, callsign || userName || `User ${userId}`);

            // Create offer to new participant
            await webrtcService.createGroupOffer(userId);
            break;
          }

          case 'participant_left':
          case 'leave_group_call': {
            console.log('[CallManager] Participant left group call');
            const payload = message.payload || message;
            const { userId } = payload as any;

            // Remove participant
            webrtcService.removeGroupParticipant(userId);
            break;
          }

          case 'force_webrtc_reconnect': {
            // No-op: this message type is no longer sent by the backend,
            // but handle it for backward compatibility
            console.log('[CallManager] Received force_webrtc_reconnect (ignored - deprecated)');
            break;
          }

          case 'call_missed': {
            console.log('[CallManager] Call missed (timeout from server)');
            toast.show('Call was not answered', 'info');
            if (callStore.isGroupCall) {
              webrtcService.endGroupCall();
            } else {
              webrtcService.endCall();
            }
            break;
          }
        }
      } catch (error) {
        console.error('[CallManager] Error handling WebRTC message:', error);
      }
    });

    return () => {
      console.log('[CallManager] Cleaning up WebRTC signaling handlers');
      removeHandler();
    };
  }, []); // Empty deps - handlers access state via getState(), don't need to re-register

  // This component doesn't render anything
  return null;
}
