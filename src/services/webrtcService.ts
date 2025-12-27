import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import {websocketService} from './websocket';
import {useCallStore, CallType} from '../store/callStore';
import {useAuthStore} from '../store/authStore';
import {requestCameraAndMicrophonePermissions, requestMicrophonePermission} from '../utils/permissions';

class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private pendingIceCandidates: RTCIceCandidate[] = [];

  // Initialize peer connection
  async initializePeerConnection(): Promise<void> {
    console.log('[WebRTC] Initializing peer connection');

    this.peerConnection = new RTCPeerConnection({
      iceServers: [], // Local network only
      iceTransportPolicy: 'all',
    });

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTC] ICE candidate generated:', event.candidate);
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
    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Remote track received:', event.track.kind);
      console.log('[WebRTC] Track enabled:', event.track.enabled);
      console.log('[WebRTC] Track muted:', event.track.muted);
      console.log('[WebRTC] Track readyState:', event.track.readyState);

      if (event.streams && event.streams[0]) {
        const remoteStream = event.streams[0];
        console.log('[WebRTC] Remote stream ID:', remoteStream.id);
        console.log('[WebRTC] Remote audio tracks:', remoteStream.getAudioTracks().length);
        console.log('[WebRTC] Remote video tracks:', remoteStream.getVideoTracks().length);

        useCallStore.getState().setRemoteStream(remoteStream);
      }
    };

    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state changed:', this.peerConnection?.connectionState);
      if (this.peerConnection?.connectionState === 'connected') {
        console.log('[WebRTC] ✅ Connection established! Setting status to active');
        useCallStore.getState().setCallStatus('active');
      } else if (
        this.peerConnection?.connectionState === 'failed' ||
        this.peerConnection?.connectionState === 'disconnected'
      ) {
        console.log('[WebRTC] ❌ Connection failed or disconnected');
        this.endCall();
      }
    };

    // Also listen to ICE connection state (more reliable in react-native-webrtc)
    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE connection state:', this.peerConnection?.iceConnectionState);
      if (this.peerConnection?.iceConnectionState === 'connected' ||
          this.peerConnection?.iceConnectionState === 'completed') {
        console.log('[WebRTC] ✅ ICE connected! Setting status to active');
        useCallStore.getState().setCallStatus('active');
      } else if (this.peerConnection?.iceConnectionState === 'failed') {
        console.log('[WebRTC] ❌ ICE connection failed');
        this.endCall();
      }
    };
  }

  // Get user media (camera/microphone)
  async getUserMedia(callType: CallType): Promise<MediaStream> {
    console.log('[WebRTC] Getting user media:', callType);

    // Request permissions first
    const hasPermissions = callType === 'video'
      ? await requestCameraAndMicrophonePermissions()
      : await requestMicrophonePermission();

    if (!hasPermissions) {
      throw new Error('Camera/Microphone permissions not granted');
    }

    const constraints = {
      audio: true,
      video: callType === 'video' ? {
        width: 640,
        height: 480,
        frameRate: 30,
        facingMode: 'user',
      } : false,
    };

    try {
      const stream = await mediaDevices.getUserMedia(constraints);
      console.log('[WebRTC] Got user media stream');
      console.log('[WebRTC] Stream ID:', stream.id);
      console.log('[WebRTC] Audio tracks:', stream.getAudioTracks().length);
      console.log('[WebRTC] Video tracks:', stream.getVideoTracks().length);

      // Log audio track details
      stream.getAudioTracks().forEach((track, index) => {
        console.log(`[WebRTC] Audio track ${index}:`, {
          id: track.id,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
      });

      useCallStore.getState().setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('[WebRTC] Error getting user media:', error);
      throw error;
    }
  }

  // Start outgoing call
  async startCall(callType: CallType): Promise<void> {
    try {
      console.log('[WebRTC] Starting call:', callType);

      // Start audio session with speaker enabled
      InCallManager.start({media: callType === 'video' ? 'video' : 'audio', auto: true, ringback: ''});
      InCallManager.setForceSpeakerphoneOn(true);
      console.log('[WebRTC] Audio session started with speaker enabled');

      // Initialize peer connection
      await this.initializePeerConnection();

      // Get user media
      const stream = await this.getUserMedia(callType);

      // Add local stream to peer connection
      console.log('[WebRTC] Adding tracks to peer connection');
      stream.getTracks().forEach((track) => {
        console.log('[WebRTC] Adding track:', track.kind, 'enabled:', track.enabled);
        this.peerConnection?.addTrack(track, stream);
      });

      // Create offer
      const offer = await this.peerConnection!.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video',
      });

      await this.peerConnection!.setLocalDescription(offer);

      console.log('[WebRTC] Created offer');

      // Send offer via WebSocket with call metadata
      const callState = useCallStore.getState();
      const {user} = useAuthStore.getState();

      // First, send initiate_call to notify recipient (same as web version)
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

      console.log('[WebRTC] Sent initiate_call message');

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

      console.log('[WebRTC] Sent webrtc_offer message');
    } catch (error) {
      console.error('[WebRTC] Error starting call:', error);
      this.endCall();
      throw error;
    }
  }

  // Answer incoming call
  async answerCall(callType: CallType, offer: RTCSessionDescription): Promise<void> {
    try {
      console.log('[WebRTC] Answering call:', callType);

      // Start audio session with speaker enabled
      InCallManager.start({media: callType === 'video' ? 'video' : 'audio', auto: true, ringback: ''});
      InCallManager.setForceSpeakerphoneOn(true);
      console.log('[WebRTC] Audio session started with speaker enabled');

      // Initialize peer connection
      await this.initializePeerConnection();

      // Get user media
      const stream = await this.getUserMedia(callType);

      // Add local stream to peer connection
      console.log('[WebRTC] Adding tracks to peer connection');
      stream.getTracks().forEach((track) => {
        console.log('[WebRTC] Adding track:', track.kind, 'enabled:', track.enabled);
        this.peerConnection?.addTrack(track, stream);
      });

      // Set remote description (offer)
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));

      // Create answer
      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);

      console.log('[WebRTC] Created answer');

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
      console.error('[WebRTC] Error answering call:', error);
      this.endCall();
      throw error;
    }
  }

  // Handle incoming answer
  async handleAnswer(answer: RTCSessionDescription): Promise<void> {
    try {
      console.log('[WebRTC] Handling answer:', answer);
      console.log('[WebRTC] Peer connection exists:', !!this.peerConnection);
      console.log('[WebRTC] Current signaling state:', this.peerConnection?.signalingState);

      if (!this.peerConnection) {
        console.error('[WebRTC] No peer connection exists!');
        return;
      }

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('[WebRTC] ✅ Remote description set successfully');
      console.log('[WebRTC] New signaling state:', this.peerConnection.signalingState);

      // Add any pending ICE candidates
      this.addPendingIceCandidates();
    } catch (error) {
      console.error('[WebRTC] ❌ Error handling answer:', error);
    }
  }

  // Handle ICE candidate
  async handleIceCandidate(candidate: RTCIceCandidate): Promise<void> {
    try {
      console.log('[WebRTC] Handling ICE candidate');

      if (this.peerConnection?.remoteDescription) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        // Queue candidates until remote description is set
        this.pendingIceCandidates.push(candidate);
      }
    } catch (error) {
      console.error('[WebRTC] Error handling ICE candidate:', error);
    }
  }

  // Add pending ICE candidates
  private async addPendingIceCandidates(): Promise<void> {
    if (this.pendingIceCandidates.length > 0) {
      console.log('[WebRTC] Adding pending ICE candidates:', this.pendingIceCandidates.length);

      for (const candidate of this.pendingIceCandidates) {
        try {
          await this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('[WebRTC] Error adding pending ICE candidate:', error);
        }
      }

      this.pendingIceCandidates = [];
    }
  }

  // End call
  endCall(): void {
    console.log('[WebRTC] Ending call');

    // Stop audio session
    InCallManager.stop();
    console.log('[WebRTC] Audio session stopped');

    // Close peer connection
    this.peerConnection?.close();
    this.peerConnection = null;

    // Clear pending candidates
    this.pendingIceCandidates = [];

    // Update call store
    useCallStore.getState().endCall();

    // Notify via WebSocket
    const callId = useCallStore.getState().callId;
    if (callId) {
      websocketService.send({
        type: 'end_call',
        payload: {callId},
      });
    }
  }

  // Toggle speaker (for use with speaker button)
  setSpeakerPhone(enable: boolean): void {
    InCallManager.setForceSpeakerphoneOn(enable);
    console.log('[WebRTC] Speaker:', enable ? 'ON' : 'OFF');
  }
}

export const webrtcService = new WebRTCService();
