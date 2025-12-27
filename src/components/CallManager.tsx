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
  const callStore = useCallStore();

  useEffect(() => {
    console.log('[CallManager] Setting up WebRTC signaling handlers');

    const removeHandler = websocketService.addMessageHandler(async (message: WebSocketMessage) => {
      try {
        console.log('[CallManager] 📨 Received message type:', message.type);
        switch (message.type) {
          case 'webrtc_offer': {
            console.log('[CallManager] Received WebRTC offer');

            // Handle both message structures
            const payload = message.payload || message;
            const {callId, offer, callerUserId, callerName, callType, conversationId} = payload as any;

            // Only handle if not already in a call
            if (callStore.status === 'idle') {
              // Update call store with incoming call info and offer
              callStore.receiveCall({
                callId,
                callType: callType || 'audio',
                callerUserId,
                callerName,
                conversationId,
                offer,
              });

              // The user will accept/reject via IncomingCallModal
              // The actual answer will be sent when user clicks accept
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

          case 'end_call': {
            console.log('[CallManager] Call ended by remote peer');
            webrtcService.endCall();
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
  }, [callStore]);

  // This component doesn't render anything
  return null;
}
