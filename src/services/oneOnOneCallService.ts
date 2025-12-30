import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import {websocketService} from './websocket';
import {useCallStore, CallType} from '../store/callStore';
import {useAuthStore} from '../store/authStore';
import {requestCameraAndMicrophonePermissions, requestMicrophonePermission} from '../utils/permissions';
import {ICE_SERVERS, getMediaConstraints, getInCallManagerOptions} from './webrtcConfig';

/**
 * OneOnOneCallService
 * Handles WebRTC logic for 1-on-1 calls
 */
export class OneOnOneCallService {
  private peerConnection: any = null;
  private pendingIceCandidates: RTCIceCandidate[] = [];

  // Initialize peer connection
  async initializePeerConnection(): Promise<void> {
    console.log('[WebRTC 1:1] Initializing peer connection');

    // Clean up any existing peer connection first
    if (this.peerConnection) {
      console.log('[WebRTC 1:1] Cleaning up existing peer connection before creating new one');
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // Handle ICE candidates
    (this.peerConnection as any).onicecandidate = (event: any) => {
      if (event.candidate) {
        console.log('[WebRTC 1:1] ICE candidate generated');
        const callState = useCallStore.getState();
        if (callState.callId) {
          websocketService.send({
            type: 'webrtc_ice_candidate',
            payload: {
              callId: callState.callId,
              candidate: {
                candidate: event.candidate.candidate,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                sdpMid: event.candidate.sdpMid,
              },
            },
          });
        }
      }
    };

    // Handle remote stream
    (this.peerConnection as any).ontrack = (event: any) => {
      console.log('[WebRTC 1:1] Remote track received:', event.track.kind);
      console.log('[WebRTC 1:1] Track enabled:', event.track.enabled);
      console.log('[WebRTC 1:1] Track muted:', event.track.muted);
      console.log('[WebRTC 1:1] Track readyState:', event.track.readyState);

      if (event.streams && event.streams[0]) {
        const remoteStream = event.streams[0];
        console.log('[WebRTC 1:1] Remote stream ID:', remoteStream.id);
        console.log('[WebRTC 1:1] Remote audio tracks:', remoteStream.getAudioTracks().length);
        console.log('[WebRTC 1:1] Remote video tracks:', remoteStream.getVideoTracks().length);

        useCallStore.getState().setRemoteStream(remoteStream);
      }
    };

    // Listen to ICE connection state
    (this.peerConnection as any).oniceconnectionstatechange = () => {
      console.log('[WebRTC 1:1] ICE connection state:', this.peerConnection?.iceConnectionState);
      if (this.peerConnection?.iceConnectionState === 'connected' ||
          this.peerConnection?.iceConnectionState === 'completed') {
        console.log('[WebRTC 1:1] ✅ ICE connected! Setting status to active');
        useCallStore.getState().setCallStatus('active');
      } else if (this.peerConnection?.iceConnectionState === 'failed') {
        console.log('[WebRTC 1:1] ❌ ICE connection failed');
        this.endCall();
      }
    };
  }

  // Get user media (camera/microphone)
  async getUserMedia(callType: CallType): Promise<MediaStream> {
    console.log('[WebRTC 1:1] Getting user media:', callType);

    // Request permissions first
    const hasPermissions = callType === 'video'
      ? await requestCameraAndMicrophonePermissions()
      : await requestMicrophonePermission();

    if (!hasPermissions) {
      throw new Error('Camera/Microphone permissions not granted');
    }

    const constraints = getMediaConstraints(callType);

    try {
      const stream = await mediaDevices.getUserMedia(constraints);
      console.log('[WebRTC 1:1] Got user media stream');
      console.log('[WebRTC 1:1] Stream ID:', stream.id);
      console.log('[WebRTC 1:1] Audio tracks:', stream.getAudioTracks().length);
      console.log('[WebRTC 1:1] Video tracks:', stream.getVideoTracks().length);

      // Log audio track details
      stream.getAudioTracks().forEach((track, index) => {
        console.log(`[WebRTC 1:1] Audio track ${index}:`, {
          id: track.id,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
      });

      useCallStore.getState().setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('[WebRTC 1:1] Error getting user media:', error);
      throw error;
    }
  }

  // Start outgoing call
  async startCall(callType: CallType): Promise<void> {
    try {
      console.log('[WebRTC 1:1] Starting call:', callType);

      // Start audio session with speaker enabled
      const options = getInCallManagerOptions(callType);
      InCallManager.start(options);
      InCallManager.setForceSpeakerphoneOn(true);
      console.log('[WebRTC 1:1] Audio session started with speaker enabled');

      // Initialize peer connection
      await this.initializePeerConnection();

      // Get user media
      const stream = await this.getUserMedia(callType);

      // Add local stream to peer connection
      console.log('[WebRTC 1:1] Adding tracks to peer connection');
      stream.getTracks().forEach((track) => {
        console.log('[WebRTC 1:1] Adding track:', track.kind, 'enabled:', track.enabled);
        this.peerConnection?.addTrack(track, stream);
      });

      // Create offer
      const offer = await this.peerConnection!.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video',
      });

      await this.peerConnection!.setLocalDescription(offer);
      console.log('[WebRTC 1:1] Created offer');

      // Send offer via WebSocket
      const callState = useCallStore.getState();
      const {user} = useAuthStore.getState();

      // First, send initiate_call to notify recipient
      websocketService.send({
        type: 'initiate_call',
        payload: {
          callId: callState.callId,
          toUserId: callState.receiverUserId,
          callType: callState.callType,
          fromUserId: user?.id,
          fromUserName: user?.callsign || user?.username || 'Unknown',
          conversationId: callState.conversationId,
        },
      });

      console.log('[WebRTC 1:1] Sent initiate_call message');

      // Then send the WebRTC offer
      websocketService.send({
        type: 'webrtc_offer',
        payload: {
          callId: callState.callId,
          offer: {
            type: offer.type,
            sdp: offer.sdp,
          },
          callType: callState.callType,
          callerUserId: user?.id,
          callerName: user?.callsign || user?.username || 'Unknown',
          conversationId: callState.conversationId,
        },
      });

      console.log('[WebRTC 1:1] Sent webrtc_offer message');
    } catch (error) {
      console.error('[WebRTC 1:1] Error starting call:', error);
      this.endCall();
      throw error;
    }
  }

  // Answer incoming call
  async answerCall(callType: CallType, offer: RTCSessionDescription): Promise<void> {
    try {
      console.log('[WebRTC 1:1] Answering call:', callType);

      // Start audio session with speaker enabled
      const options = getInCallManagerOptions(callType);
      InCallManager.start(options);
      InCallManager.setForceSpeakerphoneOn(true);
      console.log('[WebRTC 1:1] Audio session started with speaker enabled');

      // Initialize peer connection
      await this.initializePeerConnection();

      // Get user media
      const stream = await this.getUserMedia(callType);

      // Add local stream to peer connection
      console.log('[WebRTC 1:1] Adding tracks to peer connection');
      stream.getTracks().forEach((track) => {
        console.log('[WebRTC 1:1] Adding track:', track.kind, 'enabled:', track.enabled);
        this.peerConnection?.addTrack(track, stream);
      });

      // Set remote description (offer)
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));

      // Create answer
      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);
      console.log('[WebRTC 1:1] Created answer');

      // Send answer via WebSocket
      const callState = useCallStore.getState();
      websocketService.send({
        type: 'webrtc_answer',
        payload: {
          callId: callState.callId,
          answer: {
            type: answer.type,
            sdp: answer.sdp,
          },
        },
      });

      // Add any pending ICE candidates
      this.addPendingIceCandidates();
    } catch (error) {
      console.error('[WebRTC 1:1] Error answering call:', error);
      this.endCall();
      throw error;
    }
  }

  // Handle incoming answer
  async handleAnswer(answer: RTCSessionDescription): Promise<void> {
    try {
      console.log('[WebRTC 1:1] Handling answer');
      console.log('[WebRTC 1:1] Peer connection exists:', !!this.peerConnection);
      console.log('[WebRTC 1:1] Current signaling state:', this.peerConnection?.signalingState);

      if (!this.peerConnection) {
        console.error('[WebRTC 1:1] No peer connection exists!');
        return;
      }

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('[WebRTC 1:1] ✅ Remote description set successfully');

      // Add any pending ICE candidates
      this.addPendingIceCandidates();
    } catch (error) {
      console.error('[WebRTC 1:1] ❌ Error handling answer:', error);
    }
  }

  // Handle ICE candidate
  async handleIceCandidate(candidate: RTCIceCandidate): Promise<void> {
    try {
      console.log('[WebRTC 1:1] Handling ICE candidate');

      if (this.peerConnection?.remoteDescription) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        // Queue candidates until remote description is set
        this.pendingIceCandidates.push(candidate);
      }
    } catch (error) {
      console.error('[WebRTC 1:1] Error handling ICE candidate:', error);
    }
  }

  // Add pending ICE candidates
  private async addPendingIceCandidates(): Promise<void> {
    if (this.pendingIceCandidates.length > 0) {
      console.log('[WebRTC 1:1] Adding pending ICE candidates:', this.pendingIceCandidates.length);

      for (const candidate of this.pendingIceCandidates) {
        try {
          await this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('[WebRTC 1:1] Error adding pending ICE candidate:', error);
        }
      }

      this.pendingIceCandidates = [];
    }
  }

  // Reject incoming call
  rejectCall(): void {
    console.log('[WebRTC 1:1] Rejecting call');

    // Notify server about rejection
    const callState = useCallStore.getState();
    if (callState.callId) {
      websocketService.send({
        type: 'reject_call',
        payload: {
          callId: callState.callId,
          toUserId: callState.receiverUserId,
        },
      });
      console.log('[WebRTC 1:1] Sent reject_call to user', callState.receiverUserId);
    }

    // Update call store
    useCallStore.getState().endCall();
  }

  // End call
  endCall(): void {
    console.log('[WebRTC 1:1] Ending call');

    // Stop audio session
    InCallManager.stop();
    console.log('[WebRTC 1:1] Audio session stopped');

    // Stop all local tracks
    const localStream = useCallStore.getState().localStream;
    if (localStream) {
      localStream.getTracks().forEach((track: MediaStreamTrack) => {
        track.stop();
        console.log('[WebRTC 1:1] Stopped local track:', track.kind);
      });
    }

    // Stop all remote tracks
    const remoteStream = useCallStore.getState().remoteStream;
    if (remoteStream) {
      remoteStream.getTracks().forEach((track: MediaStreamTrack) => {
        track.stop();
        console.log('[WebRTC 1:1] Stopped remote track:', track.kind);
      });
    }

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
      console.log('[WebRTC 1:1] Peer connection closed and cleared');
    }

    this.pendingIceCandidates = [];

    // Notify server
    const callState = useCallStore.getState();
    if (callState.callId) {
      websocketService.send({
        type: 'end_call',
        payload: {
          callId: callState.callId,
          toUserId: callState.receiverUserId,
        },
      });
      console.log('[WebRTC 1:1] Sent end_call to user', callState.receiverUserId);
    }

    // Update call store
    useCallStore.getState().endCall();
  }
}

export const oneOnOneCallService = new OneOnOneCallService();
