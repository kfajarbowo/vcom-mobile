import {useEffect} from 'react';
import {websocketService, WebSocketMessage} from '../services/websocket';
import {webrtcService} from '../services/webrtcService';
import {useCallStore} from '../store/callStore';
import {useAuthStore} from '../store/authStore';

/**
 * CallManager - Handles WebRTC signaling coordination
 * Listens to WebSocket messages and coordinates with WebRTC service
 */
export function CallManager() {
  const {user} = useAuthStore();

  useEffect(() => {
    console.log('[CallManager] Setting up WebRTC signaling handlers');

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
            const {callId, callType, fromUserId, fromUserName} = payload as any;

            console.log('[CallManager] Incoming call details:', {
              callId,
              callType,
              fromUserId,
              fromUserName,
              currentStatus: callStore.status
            });

            // Note: We don't set up the call here, just wait for the webrtc_offer
            // The webrtc_offer handler will set up the incoming call modal
            console.log('[CallManager] Waiting for webrtc_offer to complete call setup');
            break;
          }

          case 'webrtc_offer': {
            console.log('[CallManager] Received WebRTC offer');

            // Handle both message structures
            const payload = message.payload || message;
            const {callId, offer, callerUserId, callerName, callType, conversationId} = payload as any;

            console.log('[CallManager] Offer details:', {
              callId,
              callerUserId,
              callerName,
              currentUserId: currentUser?.id,
              currentStatus: callStore.status
            });

            // Ignore offers from ourselves (echoed back from server)
            if (callerUserId === currentUser?.id) {
              console.log('[CallManager] Ignoring webrtc_offer from self');
              break;
            }

            // Validate required fields
            if (!callId || !offer || !callerUserId) {
              console.error('[CallManager] ❌ Invalid offer - missing required fields:', {
                hasCallId: !!callId,
                hasOffer: !!offer,
                hasCallerUserId: !!callerUserId
              });
              break;
            }

            // Only handle if not already in a call
            if (callStore.status === 'idle') {
              console.log('[CallManager] Setting up incoming 1-on-1 call');
              // Update call store with incoming call info and offer
              callStore.receiveCall({
                callId,
                callType: callType || 'audio',
                callerUserId,
                callerName,
                conversationId,
                offer,
              });
              console.log('[CallManager] ✅ Incoming call set to ringing status');

              // The user will accept/reject via IncomingCallModal
              // The actual answer will be sent when user clicks accept
            } else {
              console.log('[CallManager] ⚠️ Already in a call (status:', callStore.status, '), ignoring offer');
            }
            break;
          }

          case 'webrtc_answer': {
            console.log('[CallManager] 📥 Received WebRTC answer');
            console.log('[CallManager] Current call status:', callStore.status);
            console.log('[CallManager] Current callId:', callStore.callId);

            // Handle both message structures
            const payload = message.payload || message;
            const {answer} = payload as any;
            console.log('[CallManager] Extracted answer:', answer);

            if (callStore.status === 'calling') {
              console.log('[CallManager] ✅ Status is calling, processing answer');
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
            webrtcService.endCall();
            break;
          }

          case 'call_rejected': {
            console.log('[CallManager] Call rejected by remote peer');
            webrtcService.endCall();
            break;
          }

          // Group call handlers
          case 'initiate_call': {
            // This handles both 1-on-1 and group call invitations
            const payload = message.payload || message;
            const {callId, callType, fromUserId, fromUserName, conversationId, isGroupCall, groupName, participants} = payload as any;

            console.log('[CallManager] Initiate call received:', {
              callId,
              callType,
              isGroupCall,
              groupName,
              participantsCount: participants?.length,
              fromUserId
            });

            // Ignore initiate_call messages from ourselves (echoed back from server)
            if (fromUserId === currentUser?.id) {
              console.log('[CallManager] Ignoring initiate_call from self');
              break;
            }

            // If it's a group call invitation
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
                  userName: p.userName || p.callsign || `User ${p.userId || p}`
                }))
              });
            }
            break;
          }

          case 'incoming_group_call': {
            console.log('[CallManager] Incoming group call received');
            const payload = message.payload || message;
            const {callId, groupId, groupName, callType, fromUserId, fromUserName} = payload as any;

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
            } else {
              console.log('[CallManager] ⚠️ Already in a call (status:', callStore.status, '), ignoring incoming group call');
            }
            break;
          }

          case 'join_group_call': {
            console.log('[CallManager] Join group call message received');
            const payload = message.payload || message;
            const {callId, participants, groupName} = payload as any;

            // Add participants to call store if not already added
            if (participants && Array.isArray(participants)) {
              participants.forEach((participant: any) => {
                if (participant.userId !== currentUser?.id) {
                  callStore.addParticipant(
                    participant.userId,
                    participant.userName || `User ${participant.userId}`
                  );
                }
              });
            }
            break;
          }

          case 'group_call_participants_update': {
            console.log('[CallManager] Group call participants update received');
            const payload = message.payload || message;
            const {callId, participants, newParticipant} = payload as any;

            console.log('[CallManager] Participants update:', {
              callId,
              participantsCount: Array.isArray(participants) ? participants.length : 0,
              newParticipant
            });

            // Update participants in call store
            if (participants && Array.isArray(participants)) {
              // participants can be an array of IDs or objects with userId
              participants.forEach((participant: any) => {
                const participantId = typeof participant === 'number' ? participant : participant.userId;
                const participantName = typeof participant === 'object' ? participant.userName : `User ${participantId}`;

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
            const {fromUserId, offer} = payload as any;

            console.log('[CallManager] Processing group offer from:', fromUserId);
            await webrtcService.handleGroupOffer(fromUserId, offer);
            break;
          }

          case 'group_webrtc_answer': {
            console.log('[CallManager] Group WebRTC answer received');
            const payload = message.payload || message;
            const {fromUserId, answer} = payload as any;

            console.log('[CallManager] Processing group answer from:', fromUserId);
            await webrtcService.handleGroupAnswer(fromUserId, answer);
            break;
          }

          case 'group_webrtc_ice_candidate': {
            console.log('[CallManager] Group WebRTC ICE candidate received');
            const payload = message.payload || message;
            const {fromUserId, candidate} = payload as any;

            console.log('[CallManager] Processing group ICE candidate from:', fromUserId);
            await webrtcService.handleGroupIceCandidate(fromUserId, candidate);
            break;
          }

          case 'initiate_group_webrtc': {
            console.log('[CallManager] 🚀 Initiate group WebRTC received');
            const payload = message.payload || message;
            const {participants, callId} = payload as any;

            console.log('[CallManager] Initiate WebRTC details:', {
              callId,
              participantsCount: participants?.length,
              participants,
              currentUserId: currentUser?.id,
              currentCallStatus: callStore.status
            });

            // Create offers to all other participants (excluding ourselves)
            if (participants && Array.isArray(participants)) {
              console.log('[CallManager] Processing', participants.length, 'participants');

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
            const {userId, userName} = payload as any;

            // Add participant to store
            callStore.addParticipant(userId, userName || `User ${userId}`);

            // Create offer to new participant
            await webrtcService.createGroupOffer(userId);
            break;
          }

          case 'participant_left':
          case 'leave_group_call': {
            console.log('[CallManager] Participant left group call');
            const payload = message.payload || message;
            const {userId} = payload as any;

            // Remove participant
            webrtcService.removeGroupParticipant(userId);
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
