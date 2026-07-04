import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import { websocketService } from './websocket';
import { useCallStore, CallType } from '../store/callStore';
import { useAuthStore } from '../store/authStore';
import { requestCameraAndMicrophonePermissions } from '../utils/permissions';
import { getIceServers, getMediaConstraints, getInCallManagerOptions } from './webrtcConfig';

/**
 * OneOnOneCallService
 * Handles WebRTC logic for 1-on-1 calls
 */
export class OneOnOneCallService {
  private peerConnection: any = null;
  private pendingIceCandidates: RTCIceCandidate[] = [];
  private isInitializing: boolean = false;

  // Initialize peer connection
  async initializePeerConnection(): Promise<void> {
    console.log('[WebRTC 1:1] Initializing peer connection');

    // Clean up any existing peer connection first
    if (this.peerConnection) {
      console.log('[WebRTC 1:1] Cleaning up existing peer connection before creating new one');

      try {
        // Remove all senders first
        const senders = this.peerConnection.getSenders();
        senders.forEach((sender: any) => {
          if (sender.track) {
            sender.track.stop();
            this.peerConnection?.removeTrack(sender);
          }
        });
      } catch (error) {
        console.log('[WebRTC 1:1] Error removing senders:', error);
      }

      // Explicitly close peer connection and wait for TURN deallocation
      console.log('[WebRTC 1:1] Closing peer connection and releasing TURN allocation...');
      this.peerConnection.close();

      // Set to null immediately to prevent reuse
      const oldConnection = this.peerConnection;
      this.peerConnection = null;

      // Wait longer for TURN server to process deallocation (coturn needs time)
      console.log('[WebRTC 1:1] Waiting for TURN deallocation to complete...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Increased from 500ms to 1000ms
      console.log('[WebRTC 1:1] Cleanup complete, ready for new peer connection');
    }

    // Clear pending ICE candidates from previous connection
    this.pendingIceCandidates = [];
    console.log('[WebRTC 1:1] Cleared pending ICE candidates');

    const iceServers = await getIceServers();
    this.peerConnection = new RTCPeerConnection(iceServers as any);
    console.log('[WebRTC 1:1] Created fresh peer connection');

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
              targetUserId: callState.isIncoming ? callState.callerUserId : callState.receiverUserId,
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

      // Handle track mute/unmute events for video
      if (event.track.kind === 'video') {
        // Set initial state
        useCallStore.getState().setRemoteVideoEnabled(event.track.enabled && !event.track.muted);

        event.track.onmute = () => {
          console.log('[WebRTC 1:1] Remote video track muted');
          useCallStore.getState().setRemoteVideoEnabled(false);
        };

        event.track.onunmute = () => {
          console.log('[WebRTC 1:1] Remote video track unmuted');
          useCallStore.getState().setRemoteVideoEnabled(true);
        };

        // Also listen for ended event
        event.track.onended = () => {
          console.log('[WebRTC 1:1] Remote video track ended');
          useCallStore.getState().setRemoteVideoEnabled(false);
        };
      }

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
      const state = this.peerConnection?.iceConnectionState;
      const signalingState = this.peerConnection?.signalingState;
      console.log('[WebRTC 1:1] 🔄 ICE state changed:', state, '| Signaling:', signalingState);

      if (state === 'connected' || state === 'completed') {
        console.log('[WebRTC 1:1] ✅ ICE connected! Setting status to active');
        useCallStore.getState().setCallStatus('active');
      } else if (state === 'failed') {
        console.log('[WebRTC 1:1] ❌ ICE connection failed - check TURN server');
        this.endCall();
      } else if (state === 'disconnected') {
        console.log('[WebRTC 1:1] ⚠️ ICE disconnected - connection lost');
      } else if (state === 'checking') {
        console.log('[WebRTC 1:1] 🔍 ICE checking - gathering candidates...');
      }
    };

    // Listen to ICE gathering state
    (this.peerConnection as any).onicegatheringstatechange = () => {
      console.log('[WebRTC 1:1] 📡 ICE gathering state:', this.peerConnection?.iceGatheringState);
    };

    // Listen to signaling state
    (this.peerConnection as any).onsignalingstatechange = () => {
      console.log('[WebRTC 1:1] 📶 Signaling state:', this.peerConnection?.signalingState);
    };
  }

  // Get user media (camera/microphone) — always requests both
  async getUserMedia(callType: CallType): Promise<MediaStream> {
    console.log('[WebRTC 1:1] Getting user media:', callType);

    // Longer delay to ensure previous stream cleanup is complete on mobile
    await new Promise(resolve => setTimeout(resolve, 300));

    // Always request camera + mic permissions (unified call UI)
    const hasPermissions = await requestCameraAndMicrophonePermissions();

    if (!hasPermissions) {
      throw new Error('Camera/Microphone permissions not granted');
    }

    const constraints = getMediaConstraints();

    try {
      const stream = await mediaDevices.getUserMedia(constraints);
      console.log('[WebRTC 1:1] Got user media stream');
      console.log('[WebRTC 1:1] Stream ID:', stream.id);
      console.log('[WebRTC 1:1] Audio tracks:', stream.getAudioTracks().length);
      console.log('[WebRTC 1:1] Video tracks:', stream.getVideoTracks().length);

      // Camera state based on call type:
      // - video calls: camera ON by default
      // - audio calls: camera OFF by default (can be enabled via video button)
      const shouldEnableVideo = callType === 'video';
      stream.getVideoTracks().forEach(track => { track.enabled = shouldEnableVideo; });
      useCallStore.setState({ isVideoEnabled: shouldEnableVideo });

      // Log audio track details
      stream.getAudioTracks().forEach((track, index) => {
        console.log(`[WebRTC 1:1] Audio track ${index}:`, {
          id: track.id,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
      });

      // Log video track details including actual resolution selected by the camera
      stream.getVideoTracks().forEach((track, index) => {
        const settings = (track as any).getSettings ? (track as any).getSettings() : {};
        console.log(`[WebRTC 1:1] Video track ${index}:`, {
          id: track.id,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
        console.log(`[WebRTC 1:1] Video track ${index} settings:`, JSON.stringify(settings));
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
    // Prevent concurrent call initialization
    if (this.isInitializing) {
      console.warn('[WebRTC 1:1] ⚠️ Call already initializing, ignoring duplicate request');
      return;
    }

    this.isInitializing = true;

    try {
      console.log('[WebRTC 1:1] Starting call:', callType);

      // Clear any lingering state from previous calls
      const currentState = useCallStore.getState();
      if (currentState.localStream || currentState.remoteStream) {
        console.log('[WebRTC 1:1] Cleaning up lingering streams from previous call');
        currentState.localStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        currentState.remoteStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        useCallStore.getState().setLocalStream(null);
        useCallStore.getState().setRemoteStream(null);
      }

      // Start audio session — earpiece by default (camera starts off)
      const options = getInCallManagerOptions(callType);
      InCallManager.start(options);
      InCallManager.setForceSpeakerphoneOn(false);
      console.log('[WebRTC 1:1] Audio session started, speaker: false');

      // Initialize peer connection
      await this.initializePeerConnection();

      // Get user media
      const stream = await this.getUserMedia(callType);

      // Add local stream to peer connection in consistent order (audio first, then video)
      console.log('[WebRTC 1:1] Adding tracks to peer connection');

      // Add audio tracks first
      stream.getAudioTracks().forEach((track) => {
        console.log('[WebRTC 1:1] Adding audio track, enabled:', track.enabled);
        this.peerConnection?.addTrack(track, stream);
      });

      // Then add video tracks (disabled at track level, but present in SDP)
      stream.getVideoTracks().forEach((track) => {
        console.log('[WebRTC 1:1] Adding video track, enabled:', track.enabled);
        this.peerConnection?.addTrack(track, stream);
      });

      // Boost video bitrate to prevent blurriness on low-end devices
      await this.boostVideoBitrate();

      // Create offer — always receive video for unified call UI
      const offer = await this.peerConnection!.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await this.peerConnection!.setLocalDescription(offer);
      console.log('[WebRTC 1:1] Created offer');

      // Send offer via WebSocket
      const callState = useCallStore.getState();
      const { user } = useAuthStore.getState();

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
          toUserId: callState.receiverUserId,  // Add target user ID
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
    } finally {
      this.isInitializing = false;
    }
  }

  // Answer incoming call
  async answerCall(callType: CallType, offer: RTCSessionDescription): Promise<void> {
    // Prevent concurrent call initialization
    if (this.isInitializing) {
      console.warn('[WebRTC 1:1] ⚠️ Call already initializing, ignoring duplicate answer request');
      return;
    }

    this.isInitializing = true;

    try {
      console.log('[WebRTC 1:1] Answering call:', callType);

      // Clear any lingering state from previous calls
      const currentState = useCallStore.getState();
      if (currentState.localStream || currentState.remoteStream) {
        console.log('[WebRTC 1:1] Cleaning up lingering streams from previous call');
        currentState.localStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        currentState.remoteStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        useCallStore.getState().setLocalStream(null);
        useCallStore.getState().setRemoteStream(null);
      }

      // Save ICE candidates received while ringing (before peer connection was created).
      // initializePeerConnection() clears pendingIceCandidates, so we must preserve them.
      const savedIceCandidates = [...this.pendingIceCandidates];
      console.log('[WebRTC 1:1] Saved', savedIceCandidates.length, 'ICE candidates received while ringing');

      // Start audio session — earpiece by default (camera starts off)
      const options = getInCallManagerOptions(callType);
      InCallManager.start(options);
      InCallManager.setForceSpeakerphoneOn(false);
      console.log('[WebRTC 1:1] Audio session started, speaker: false');

      // Initialize peer connection (this clears pendingIceCandidates)
      await this.initializePeerConnection();

      // Restore saved ICE candidates so they can be added after remote description is set
      this.pendingIceCandidates = savedIceCandidates;
      console.log('[WebRTC 1:1] Restored', savedIceCandidates.length, 'saved ICE candidates');

      // Get user media
      const stream = await this.getUserMedia(callType);

      // Add local stream to peer connection in consistent order (audio first, then video)
      console.log('[WebRTC 1:1] Adding tracks to peer connection');

      // Add audio tracks first
      stream.getAudioTracks().forEach((track) => {
        console.log('[WebRTC 1:1] Adding audio track, enabled:', track.enabled);
        this.peerConnection?.addTrack(track, stream);
      });

      // Then add video tracks
      stream.getVideoTracks().forEach((track) => {
        console.log('[WebRTC 1:1] Adding video track, enabled:', track.enabled);
        this.peerConnection?.addTrack(track, stream);
      });

      // Boost video bitrate to prevent blurriness on low-end devices
      await this.boostVideoBitrate();

      // Set remote description (offer)
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));

      // Create answer
      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);
      console.log('[WebRTC 1:1] Created answer');

      // Get call state
      const callState = useCallStore.getState();
      const { user } = useAuthStore.getState();

      // Send accept_call message to server to notify the caller
      websocketService.send({
        type: 'accept_call',
        payload: {
          callId: callState.callId,
          toUserId: callState.callerUserId,
        },
      });
      console.log('[WebRTC 1:1] Sent accept_call to caller:', callState.callerUserId);

      // Send answer via WebSocket
      websocketService.send({
        type: 'webrtc_answer',
        payload: {
          callId: callState.callId,
          toUserId: callState.callerUserId,  // Send answer back to the caller
          answer: {
            type: answer.type,
            sdp: answer.sdp,
          },
        },
      });
      console.log('[WebRTC 1:1] Sent webrtc_answer to caller:', callState.callerUserId);

      // Add any pending ICE candidates
      this.addPendingIceCandidates();
    } catch (error) {
      console.error('[WebRTC 1:1] Error answering call:', error);
      this.endCall();
      throw error;
    } finally {
      this.isInitializing = false;
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

  // Boost video sender bitrate to prevent blurriness
  // WebRTC defaults to very low bitrate on some devices (especially MediaTek),
  // causing the video to look blurry even at 720p capture resolution.
  private async boostVideoBitrate(): Promise<void> {
    try {
      if (!this.peerConnection) return;

      const senders = this.peerConnection.getSenders();
      for (const sender of senders) {
        if (sender.track?.kind === 'video') {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 1500000; // 1.5 Mbps for clear 720p
          params.encodings[0].maxFramerate = 30;
          await sender.setParameters(params);
          console.log('[WebRTC 1:1] ✅ Video bitrate boosted to 1.5 Mbps');
        }
      }
    } catch (error) {
      console.warn('[WebRTC 1:1] Could not boost video bitrate:', error);
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
      // When rejecting, we're the receiver, so notify the caller
      const otherUserId = callState.callerUserId;

      if (otherUserId) {
        websocketService.send({
          type: 'reject_call',
          payload: {
            callId: callState.callId,
            toUserId: otherUserId,
          },
        });
        console.log('[WebRTC 1:1] Sent reject_call to caller', otherUserId);
      } else {
        console.warn('[WebRTC 1:1] Could not determine caller to notify about rejection');
      }
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

    // Remove tracks from peer connection first
    if (this.peerConnection) {
      console.log('[WebRTC 1:1] Removing all tracks from peer connection');
      try {
        const senders = this.peerConnection.getSenders();
        senders.forEach((sender: any) => {
          if (sender.track) {
            const trackKind = sender.track.kind;
            sender.track.stop();
            this.peerConnection?.removeTrack(sender);
            console.log('[WebRTC 1:1] Removed and stopped track from peer connection:', trackKind);
          }
        });
      } catch (error) {
        console.log('[WebRTC 1:1] Error removing tracks (may be already removed):', error);
      }
    }

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
      // Determine who to notify based on whether this is incoming or outgoing call
      const otherUserId = callState.isIncoming
        ? callState.callerUserId
        : callState.receiverUserId;

      if (otherUserId) {
        websocketService.send({
          type: 'end_call',
          payload: {
            callId: callState.callId,
            toUserId: otherUserId,
          },
        });
        console.log('[WebRTC 1:1] Sent end_call to user', otherUserId);
      } else {
        console.warn('[WebRTC 1:1] Could not determine other user to notify about call end');
      }
    }

    // Update call store
    useCallStore.getState().endCall();

    // Reset initialization flag
    this.isInitializing = false;
  }
}

export const oneOnOneCallService = new OneOnOneCallService();
