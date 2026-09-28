import { useEffect } from 'react';
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
  useAuthStore();
  const toast = useToast();

  // Handle call action events from native notification (accept/reject from lock screen)
  useEffect(() => {
    const removeCallActionListener = callNotificationService.addCallActionListener(
      async (event: CallActionEvent) => {
        console.log('[CallManager] Call action from notification:', event);
        const callStore = useCallStore.getState();

        // A stale lock-screen action (from a notification that outlived the call it belonged to)
        // must not act on whatever call happens to be current now. Only honour an action whose
        // callId matches the call we are ringing, when one is present.
        const eventCallId = (event as any).callId;
        const matchesCurrent = !eventCallId || !callStore.callId || eventCallId === callStore.callId;

        if (event.action === 'accept') {
          // If we have a pending call in ringing state, accept it
          if (callStore.status === 'ringing' && matchesCurrent) {
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

              // The offer may still be in flight (the targeted webrtc_offer can lag the
              // incoming_call, especially right after a background socket reconnect). Wait briefly
              // for it before giving up.
              if (!offer) {
                for (let i = 0; i < 20 && !offer; i++) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                  offer = useCallStore.getState().offer;
                }
              }

              if (offer) {
                await webrtcService.answerCall(callStore.callType, offer);
              } else {
                console.error('[CallManager] Cannot answer call - no offer available');
                toast.show('Call failed: No connection offer', 'error');
                // Tell the server we could not take the call (rejectCall sends reject_call) so the
                // caller stops ringing immediately, instead of a store-only reset that leaves the
                // caller ringing until the 30s timeout.
                webrtcService.rejectCall();
              }
            }
          }
        } else if (event.action === 'reject') {
          console.log('[CallManager] Rejecting call from notification');
          callNotificationService.cancelCallNotification();
          // Only tear down a call if this decline is for the call we're actually ringing.
          if (callStore.status === 'ringing' && matchesCurrent) {
            if (callStore.isGroupCall) {
              // Send reject_group_call (not leave_group_call): the invitee was never in the
              // participant set, so leaving is a no-op and the group is never told about the decline.
              const me = useAuthStore.getState().user;
              websocketService.send({
                type: 'reject_group_call',
                payload: {
                  callId: callStore.callId,
                  groupId: callStore.conversationId,
                  fromUserId: me?.id,
                  userName: me?.callsign || me?.fullName,
                },
              });
              callStore.endCall();
            } else {
              webrtcService.rejectCall();
            }
          }
        } else if (event.action === 'missed') {
          console.log('[CallManager] Call missed (timeout)');
          callNotificationService.cancelCallNotification();
          if (callStore.status === 'ringing' && matchesCurrent) {
            callStore.endCall();
          }
        }
      }
    );

    return () => {
      removeCallActionListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  useEffect(() => {
    console.log('[CallManager] Setting up WebRTC signaling handlers');

    // Buffer for offers that arrive before incoming_call. Web clients send offers untargeted and
    // the server broadcasts them to every user, so this device receives the SDP of every
    // web-initiated 1:1 call in the org. Entries not addressed to us are never consumed, so we
    // store a timestamp and evict anything older than 60s to stop unbounded growth.
    const pendingOffers = new Map<string, { offer: any; ts: number }>();
    const PENDING_OFFER_TTL_MS = 60000;
    const sweepPendingOffers = () => {
      const now = Date.now();
      for (const [id, entry] of pendingOffers) {
        if (now - entry.ts > PENDING_OFFER_TTL_MS) {
          pendingOffers.delete(id);
        }
      }
    };

    const removeHandler = websocketService.addMessageHandler(async (message: WebSocketMessage) => {
      try {
        // Skip non-call messages early to avoid unnecessary processing
        const callMessageTypes = new Set([
          'incoming_call', 'webrtc_offer', 'webrtc_answer', 'webrtc_ice_candidate',
          'call_accepted', 'end_call', 'call_ended', 'call_rejected', 'call_failed',
          'initiate_call', 'incoming_group_call', 'join_group_call',
          'group_call_initiated', 'group_call_participants_update',
          'group_webrtc_offer', 'group_webrtc_answer', 'group_webrtc_ice_candidate',
          'initiate_group_webrtc', 'participant_joined', 'participant_left',
          'leave_group_call', 'force_webrtc_reconnect', 'call_missed',
          // Group-call lifecycle signals the server emits that were previously dropped:
          // group cancelled/ended, a participant hung up, an invitee declined, nobody online,
          // and the web client's mesh-repair request.
          'group_call_ended', 'group_call_user_left', 'group_call_rejected',
          'group_call_no_participants', 'group_participant_refresh',
        ]);
        if (!callMessageTypes.has(message.type)) {return;}

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
              currentStatus: callStore.status,
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
              const pendingEntry = pendingOffers.get(callId);
              const pendingOffer = pendingEntry?.offer;
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

                // Always show native notification for incoming calls to mimic background behavior as requested
                console.log('[CallManager] Showing native notification for incoming call (buffered offer case)');
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
              } else {
                console.log('[CallManager] ✅ Call metadata stored, waiting for offer');
              }
            } else {
              console.log('[CallManager] ⚠️ Already in a call, ignoring incoming_call');
              // Drop any buffered offer for this call we're rejecting so it doesn't linger.
              pendingOffers.delete(callId);
              // Send busy signal
              websocketService.send({
                type: 'reject_call',
                payload: {
                  callId,
                  toUserId: fromUserId,
                  reason: 'busy',
                },
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

            console.log('[CallManager] Offer SDP received for callId:', callId);
            console.log('[CallManager] Current call status:', callStore.status);
            console.log('[CallManager] Current callId in store:', callStore.callId);
            console.log('[CallManager] CallId match:', callStore.callId === callId);
            console.log('[CallManager] Has offer in store before:', !!callStore.offer);

            // Validate required fields
            if (!callId || !offer) {
              console.error('[CallManager] ❌ Invalid offer - missing callId or offer:', {
                hasCallId: !!callId,
                hasOffer: !!offer,
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

              // Always show native notification for incoming calls to mimic background behavior as requested
              console.log('[CallManager] Showing native notification for incoming call (standard offer case)');
              callNotificationService.showIncomingCallNotification({
                callId,
                callerId: String(callStore.callerUserId),
                callerName: callStore.callerName || 'Unknown',
                callType: callType || 'audio',
                isGroupCall: false,
              });

              // Set timeout to auto-reset if notification not answered (35 seconds)
              setTimeout(() => {
                const currentState = useCallStore.getState();
                if (currentState.callId === callId && currentState.status === 'ringing') {
                  console.log('[CallManager] ⏱️ Notification timed out, resetting call state');
                  callStore.reset();
                }
              }, 35000); // 35 seconds (Android notification timeout is 30s)
            } else if ((callStore.status === 'active' || callStore.status === 'calling') && callStore.callId === callId && !callStore.isGroupCall) {
              // A second offer for the call we're already in = renegotiation (ICE restart, or the
              // peer enabling video mid-call). Apply it and answer without disturbing media.
              console.log('[CallManager] 🔁 Renegotiation offer for active call');
              await webrtcService.handleRenegotiationOffer(offer);
            } else if (callStore.status === 'idle') {
              // webrtc_offer arrived before incoming_call
              // Buffer it and let incoming_call set up the call state to avoid race condition
              console.warn('[CallManager] ⚠️ Received webrtc_offer before incoming_call - buffering');
              sweepPendingOffers();
              pendingOffers.set(callId, { offer, ts: Date.now() });
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
            const { answer, callId: answerCallId } = payload as any;

            // Drop answers that don't belong to our current call. The web client sends answers
            // untargeted and the server broadcasts them to everyone, so without this a foreign
            // call's answer could be applied to (and wedge) our in-progress call.
            if (callStore.isGroupCall) {
              console.log('[CallManager] Ignoring 1:1 answer while in a group call');
              break;
            }
            if (answerCallId && callStore.callId && answerCallId !== callStore.callId) {
              console.log('[CallManager] Ignoring answer for different callId:', answerCallId, 'current:', callStore.callId);
              break;
            }

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
            const iceCallId = message.payload?.callId ?? (message as any).callId;

            if (!candidate) {
              console.error('[CallManager] ❌ No candidate found!');
              console.error('[CallManager] Message:', JSON.stringify(message, null, 2));
              break;
            }

            // Only accept 1:1 ICE for the current 1:1 call. Reject while in a group call, when idle
            // (no call to attach them to — otherwise foreign broadcast candidates accumulate and get
            // injected into the next real call), or when the callId doesn't match.
            if (callStore.isGroupCall) {
              console.log('[CallManager] Ignoring 1:1 ICE while in a group call');
              break;
            }
            if (!callStore.callId) {
              console.log('[CallManager] Ignoring 1:1 ICE while idle (no active/ringing call)');
              break;
            }
            if (iceCallId && iceCallId !== callStore.callId) {
              console.log('[CallManager] Ignoring ICE for different callId:', iceCallId, 'current:', callStore.callId);
              break;
            }

            console.log('[CallManager] Processing ICE candidate');
            await webrtcService.handleIceCandidate(candidate);
            break;
          }

          case 'call_accepted': {
            console.log('[CallManager] 🎉 Call accepted by remote peer!');
            const payload = message.payload || message;
            const { callId: acceptedCallId } = payload as any;
            if (acceptedCallId && callStore.callId && acceptedCallId !== callStore.callId) {
              console.log('[CallManager] Ignoring call_accepted for different callId');
              break;
            }
            // Change status from "calling" to "active"
            if (callStore.status === 'calling') {
              callStore.setCallStatus('active');
            }
            break;
          }

          case 'end_call':
          case 'call_ended': {
            const payload = message.payload || message;
            const { callId: endedCallId } = payload as any;
            // Only end if this termination is for the call we're actually in. A stale/misrouted
            // call_ended for a previous callId must not tear down a new call.
            if (endedCallId && callStore.callId && endedCallId !== callStore.callId) {
              console.log('[CallManager] Ignoring end_call/call_ended for different callId:', endedCallId);
              break;
            }
            console.log('[CallManager] Call ended by remote peer');
            callNotificationService.cancelCallNotification();
            if (callStore.isGroupCall) {
              webrtcService.endGroupCall();
            } else {
              webrtcService.endCall();
            }
            break;
          }

          case 'call_rejected': {
            const payload = message.payload || message;
            const { callId: rejectedCallId } = payload as any;
            if (rejectedCallId && callStore.callId && rejectedCallId !== callStore.callId) {
              console.log('[CallManager] Ignoring call_rejected for different callId');
              break;
            }
            console.log('[CallManager] Call rejected by remote peer');
            callNotificationService.cancelCallNotification();
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
            callNotificationService.cancelCallNotification();
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
            const { callId, callType, fromUserId, fromUserName, conversationId, isGroupCall, participants } = payload as any;

            console.log('[CallManager] Initiate call received:', {
              callId,
              callType,
              isGroupCall,
              groupName,
              participantsCount: participants?.length,
              fromUserId,
              fromUserName,
              conversationId,
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
                  userName: p.callsign || p.userName || `User ${p.userId || p}`,
                })),
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
              currentStatus: callStore.status,
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
                  userName: fromUserName || `User ${fromUserId}`,
                }],
              });
              console.log('[CallManager] ✅ Group call set to ringing status, participants:', [{
                userId: fromUserId,
                userName: fromUserName || `User ${fromUserId}`,
              }]);

              // Always show native notification for incoming calls to mimic background behavior as requested
              console.log('[CallManager] Showing native notification for group call');
              callNotificationService.showIncomingCallNotification({
                callId,
                callerId: String(fromUserId),
                callerName: groupName || 'Group Call',
                callType: callType || 'audio',
                isGroupCall: true,
              });

              // Auto-reset if the group ring is never answered, mirroring the 1:1 paths. Without
              // this a cancelled group call leaves the invitee stuck 'ringing' forever (which also
              // busy-rejects every subsequent incoming call).
              setTimeout(() => {
                const s = useCallStore.getState();
                if (s.callId === callId && s.status === 'ringing') {
                  console.log('[CallManager] ⏱️ Group call ring timed out, resetting');
                  callNotificationService.cancelCallNotification();
                  s.reset();
                }
              }, 35000);
            } else {
              console.log('[CallManager] ⚠️ Already in a call (status:', callStore.status, '), ignoring incoming group call');

              // If already in the SAME group call, just ignore — don't reject
              // Rejecting would remove us from the server's participant set
              if (callStore.isGroupCall && callStore.conversationId === groupId) {
                console.log('[CallManager] Already in this group call, silently ignoring notification');
              } else {
                // Different call — reject
                websocketService.send({
                  type: 'reject_group_call',
                  payload: {
                    callId,
                    groupId,
                    fromUserId: currentUser?.id,
                    userName: currentUser?.callsign || currentUser?.fullName,
                  },
                });
              }
            }
            break;
          }

          case 'join_group_call': {
            console.log('[CallManager] Join group call message received');
            const payload = message.payload || message;
            const { callId, participants } = payload as any;

            // Ignore updates that aren't for our current group call (a different group's call could
            // otherwise inject phantom participants into this one).
            if (!callStore.isGroupCall || (callId && callStore.callId && callId !== callStore.callId)) {
              console.log('[CallManager] Ignoring join_group_call for a call we are not in');
              break;
            }

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

          case 'group_call_initiated': {
            // Server responds with the actual callId (may differ from what mobile sent for rejoin)
            console.log('[CallManager] Group call initiated response received');
            const payload = message.payload || message;
            const { callId: serverCallId, isRejoin } = payload as any;

            // If this is a rejoin and the server gave us a different callId, update our local state
            if (isRejoin && serverCallId && callStore.callId !== serverCallId) {
              console.log(`[CallManager] Rejoin: updating local callId from ${callStore.callId} to ${serverCallId}`);
              useCallStore.setState({ callId: serverCallId });
            }
            break;
          }

          case 'group_call_participants_update': {
            console.log('[CallManager] Group call participants update received');
            const payload = message.payload || message;
            const { callId, participants, participantData, newParticipant } = payload as any;

            // Only apply updates for the group call we're actually in. The server's rejoin path
            // broadcasts this to ALL group members, so a different group's update would otherwise
            // inject streamless ghost tiles into our current call.
            if (!callStore.isGroupCall || (callId && callStore.callId && callId !== callStore.callId)) {
              console.log('[CallManager] Ignoring participants update for a call we are not in');
              break;
            }

            console.log('[CallManager] Participants update:', {
              callId,
              participantsCount: Array.isArray(participants) ? participants.length : 0,
              hasParticipantData: !!participantData,
              newParticipant,
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
                    ? (participant.callsign || participant.userName || undefined)
                    : undefined);

                if (participantId && participantId !== currentUser?.id) {
                  const existing = callStore.getParticipant(participantId);
                  if (!existing) {
                    callStore.addParticipant(participantId, participantName || `User ${participantId}`);
                  } else if (participantName && (existing.userName === '...' || existing.userName.startsWith('User '))) {
                    // Update placeholder name with resolved name
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
              currentCallStatus: callStore.status,
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

              // Build name lookup from participant objects
              const nameLookup = new Map<number, string>();
              participants.forEach((p: any) => {
                if (p.userId && p.userName) {
                  nameLookup.set(p.userId, p.userName);
                }
              });

              for (const participantId of uniqueParticipants) {
                console.log('[CallManager] Checking participant:', participantId, 'vs current user:', currentUser?.id);
                if (participantId !== currentUser?.id) {
                  // Add/update participant name from server-resolved data
                  const resolvedName = nameLookup.get(participantId);
                  if (resolvedName) {
                    const existing = callStore.getParticipant(participantId);
                    if (!existing || existing.userName === '...' || existing.userName.startsWith('User ')) {
                      callStore.addParticipant(participantId, resolvedName);
                    }
                  }
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
            const missedPayload = message.payload || message;
            const { reason, fromUserName, callId: missedCallId } = missedPayload as any;
            console.log('[CallManager] Call missed:', reason, fromUserName);

            if (reason === 'offline' && fromUserName) {
              // Missed call notification delivered on reconnect — informational only, do NOT tear
              // down whatever call may be active now.
              toast.show(`Missed call from ${fromUserName}`, 'info');
            } else {
              // Caller side - call was not answered. Only end if it's for our current call.
              if (missedCallId && callStore.callId && missedCallId !== callStore.callId) {
                console.log('[CallManager] Ignoring call_missed for different callId');
                break;
              }
              callNotificationService.cancelCallNotification();
              toast.show('Call was not answered', 'info');
              if (callStore.isGroupCall) {
                webrtcService.endGroupCall();
              } else {
                webrtcService.endCall();
              }
            }
            break;
          }

          case 'group_call_ended': {
            // The whole group call ended (last participant left, or the initiator cancelled).
            const payload = message.payload || message;
            const { callId: endedCallId, groupId } = payload as any;
            const inThisCall = callStore.isGroupCall && (
              (endedCallId && callStore.callId === endedCallId) ||
              (groupId != null && callStore.conversationId === groupId)
            );
            if (inThisCall || (callStore.isGroupCall && !endedCallId && !groupId)) {
              console.log('[CallManager] Group call ended, tearing down');
              callNotificationService.cancelCallNotification();
              // endGroupCall works whether we were ringing or active; it resets the store.
              webrtcService.endGroupCall();
            } else {
              console.log('[CallManager] Ignoring group_call_ended for a call we are not in');
            }
            break;
          }

          case 'group_call_user_left': {
            // The web client leaves a group call via end_call{isGroupCall}; the server relays this
            // top-level shape (no payload wrapper, no callId — just userId/roomId).
            const payload = message.payload || message;
            const { userId: leftUserId, roomId } = payload as any;
            if (callStore.isGroupCall && leftUserId != null &&
                (roomId == null || callStore.conversationId === roomId)) {
              console.log('[CallManager] Group participant left:', leftUserId);
              webrtcService.removeGroupParticipant(leftUserId);
            }
            break;
          }

          case 'group_call_rejected': {
            // An invitee declined. Inform the initiator; teardown is handled by the ring timeout /
            // group_call_ended so a single decline doesn't drop a call others may still join.
            const payload = message.payload || message;
            const { rejectedByUserName } = payload as any;
            if (callStore.isGroupCall) {
              toast.show(`${rejectedByUserName || 'A member'} declined the call`, 'info');
            }
            break;
          }

          case 'group_call_no_participants': {
            // No group members were online to receive the invitation.
            if (callStore.isGroupCall && callStore.status === 'calling') {
              console.log('[CallManager] Group call: no participants online');
              toast.show('No group members are online to answer', 'info');
              callNotificationService.cancelCallNotification();
              webrtcService.endGroupCall();
            }
            break;
          }

          case 'group_participant_refresh': {
            // The web client asks us to re-offer to a peer whose mesh leg broke.
            const payload = message.payload || message;
            const { fromUserId, callId: refreshCallId } = payload as any;
            if (callStore.isGroupCall && fromUserId != null &&
                (!refreshCallId || callStore.callId === refreshCallId) &&
                fromUserId !== currentUser?.id) {
              console.log('[CallManager] Group participant refresh — re-offering to:', fromUserId);
              await webrtcService.createGroupOffer(fromUserId);
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // This component doesn't render anything
  return null;
}
