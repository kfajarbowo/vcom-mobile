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
import { getIceServers, getMediaConstraints, getAudioOnlyConstraints, getInCallManagerOptions } from './webrtcConfig';

/**
 * OneOnOneCallService
 * Handles WebRTC logic for 1-on-1 calls
 */
export class OneOnOneCallService {
  private peerConnection: any = null;
  private pendingIceCandidates: RTCIceCandidate[] = [];
  private isInitializing: boolean = false;
  private iceRestartAttempts: number = 0;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_ICE_RESTARTS = 2;
  private static readonly DISCONNECT_GRACE_MS = 6000;

  // The other party in the current call (caller when we are the callee, receiver when we called).
  private getOtherUserId(): number | null {
    const s = useCallStore.getState();
    return s.isIncoming ? s.callerUserId : s.receiverUserId;
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  // True if the call we were setting up is no longer the current one (cancelled / replaced / reset).
  private aborted(capturedCallId: string | null): boolean {
    const s = useCallStore.getState();
    return s.status === 'idle' || s.callId !== capturedCallId;
  }

  // Release a just-acquired stream and tear down the half-built peer connection after an aborted
  // setup, so no camera/mic capture leaks.
  private abortSetup(stream?: MediaStream | null): void {
    try {
      stream?.getTracks().forEach((track: MediaStreamTrack) => {
        track.stop();
      });
      // ONLY release the stream, which will natively clean up the capturer and its tracks.
      // Do not call track.release() individually to avoid double-dispose.
      try { (stream as any).release?.(); } catch (e) { /* no-op */ }
    } catch (e) { /* no-op */ }
    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (e) { /* no-op */ }
      this.peerConnection = null;
    }
    this.pendingIceCandidates = [];
    InCallManager.stop();
  }

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
        this.clearDisconnectTimer();
        this.iceRestartAttempts = 0;
        useCallStore.getState().setCallStatus('active');
      } else if (state === 'failed') {
        // Don't hang up on the first failure — mobile networks blip constantly. Attempt a bounded
        // ICE restart (re-offer with iceRestart) and only end the call if recovery is exhausted.
        console.log('[WebRTC 1:1] ❌ ICE connection failed - attempting recovery');
        this.tryIceRestart();
      } else if (state === 'disconnected') {
        // 'disconnected' is often transient and self-heals. Give it a grace window before treating
        // it as a failure and attempting a restart.
        console.log('[WebRTC 1:1] ⚠️ ICE disconnected - starting grace timer');
        this.clearDisconnectTimer();
        this.disconnectTimer = setTimeout(() => {
          const st = this.peerConnection?.iceConnectionState;
          if (st === 'disconnected' || st === 'failed') {
            console.log('[WebRTC 1:1] ICE still', st, 'after grace period - attempting recovery');
            this.tryIceRestart();
          }
        }, OneOnOneCallService.DISCONNECT_GRACE_MS);
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
      throw new Error('Microphone permission not granted');
    }

    try {
      // Try audio+video first so mid-call video works when a camera is available. If the camera is
      // denied or busy (NotReadableError), fall back to audio-only so the call still succeeds
      // instead of tearing down. Video calls that fall back become audio-only (best effort).
      let stream: MediaStream;
      try {
        stream = await mediaDevices.getUserMedia(getMediaConstraints(true));
      } catch (videoError) {
        console.warn('[WebRTC 1:1] getUserMedia with video failed, falling back to audio-only:', videoError);
        stream = await mediaDevices.getUserMedia(getAudioOnlyConstraints());
      }
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
    // Capture the call identity at entry so we can detect if the caller cancels (or a different
    // call replaces this one) while we run the ~0.3-2s of async setup below.
    const capturedCallId = useCallStore.getState().callId;

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

      // Start audio session. Video calls route to the loudspeaker; audio calls use the earpiece.
      const options = getInCallManagerOptions(callType);
      InCallManager.start(options);
      const useSpeaker = callType === 'video';
      InCallManager.setForceSpeakerphoneOn(useSpeaker);
      useCallStore.setState({ isSpeakerEnabled: useSpeaker });
      console.log('[WebRTC 1:1] Audio session started, speaker:', useSpeaker);

      // Initialize peer connection
      await this.initializePeerConnection();

      // Get user media
      const stream = await this.getUserMedia(callType);

      // The caller may have cancelled (or a different call started) while media was acquiring. If
      // so, release what we grabbed and abort — otherwise the mic/camera stay hot with no UI and
      // we'd send signaling with a null target (which the server broadcasts to everyone).
      if (this.aborted(capturedCallId)) {
        this.abortSetup(stream);
        return;
      }

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

      // Never emit signaling with a null callId/target: the server broadcasts toUserId-less
      // messages to every connected user, poisoning other calls.
      if (this.aborted(capturedCallId) || !callState.callId || !callState.receiverUserId) {
        console.warn('[WebRTC 1:1] Aborting outgoing call — missing callId/receiver or call cancelled');
        this.abortSetup(stream);
        return;
      }

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
    const capturedCallId = useCallStore.getState().callId;

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

      // Start audio session. Video calls route to the loudspeaker; audio calls use the earpiece.
      const options = getInCallManagerOptions(callType);
      InCallManager.start(options);
      const useSpeaker = callType === 'video';
      InCallManager.setForceSpeakerphoneOn(useSpeaker);
      useCallStore.setState({ isSpeakerEnabled: useSpeaker });
      console.log('[WebRTC 1:1] Audio session started, speaker:', useSpeaker);

      // Initialize peer connection (this clears pendingIceCandidates)
      await this.initializePeerConnection();

      // Restore saved ICE candidates so they can be added after remote description is set.
      // Prepend (not overwrite): candidates that trickled in during initializePeerConnection's
      // async work were pushed onto the freshly-cleared queue and must be kept too.
      this.pendingIceCandidates = [...savedIceCandidates, ...this.pendingIceCandidates];
      console.log('[WebRTC 1:1] Restored', savedIceCandidates.length, 'saved ICE candidates (total queued:', this.pendingIceCandidates.length, ')');

      // Get user media
      const stream = await this.getUserMedia(callType);

      // The caller may have cancelled while we were acquiring media (a very common race). Abort
      // cleanly rather than building a live pc into an idle store and sending a null-target answer.
      if (this.aborted(capturedCallId)) {
        console.warn('[WebRTC 1:1] Call no longer active after media acquisition, aborting answer');
        this.abortSetup(stream);
        return;
      }

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

      // Guard against a cancelled/reset call: never emit accept_call/webrtc_answer with a null
      // callId or caller — the server would broadcast the answer to every user.
      if (this.aborted(capturedCallId) || !callState.callId || !callState.callerUserId) {
        console.warn('[WebRTC 1:1] Aborting answer send — missing callId/caller or call cancelled');
        this.abortSetup(useCallStore.getState().localStream);
        return;
      }

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

  // Attempt a bounded ICE restart by creating a fresh offer with iceRestart:true and re-sending it.
  // The peer applies it via handleRenegotiationOffer (a webrtc_offer for the current active call).
  private async tryIceRestart(): Promise<void> {
    if (!this.peerConnection) {return;}
    if ((this.peerConnection.signalingState as string) === 'closed') {return;}

    if (this.iceRestartAttempts >= OneOnOneCallService.MAX_ICE_RESTARTS) {
      console.log('[WebRTC 1:1] ICE restart budget exhausted - ending call');
      this.clearDisconnectTimer();
      this.endCall();
      return;
    }
    this.iceRestartAttempts++;

    try {
      const otherUserId = this.getOtherUserId();
      const callState = useCallStore.getState();
      if (!otherUserId || !callState.callId) {
        console.warn('[WebRTC 1:1] Cannot ICE-restart: missing peer or callId');
        return;
      }

      console.log('[WebRTC 1:1] 🔄 ICE restart attempt', this.iceRestartAttempts);
      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);

      websocketService.send({
        type: 'webrtc_offer',
        payload: {
          callId: callState.callId,
          toUserId: otherUserId,
          offer: { type: offer.type, sdp: offer.sdp },
          callType: callState.callType,
          callerUserId: useAuthStore.getState().user?.id,
          renegotiation: true,
        },
      });
      console.log('[WebRTC 1:1] Sent ICE-restart offer to', otherUserId);
    } catch (error) {
      console.error('[WebRTC 1:1] ICE restart failed:', error);
    }
  }

  // Handle a webrtc_offer that arrives for the CURRENT active/connecting call — a renegotiation
  // (ICE restart, or the peer enabling video mid-call). Apply it and answer, without disturbing
  // the existing media/tracks.
  async handleRenegotiationOffer(offer: RTCSessionDescription): Promise<void> {
    try {
      if (!this.peerConnection) {
        console.warn('[WebRTC 1:1] No peer connection for renegotiation offer');
        return;
      }
      const sigState = this.peerConnection.signalingState;
      if (sigState !== 'stable') {
        // Glare: both sides offered at once. Let the existing flow settle rather than colliding.
        console.warn('[WebRTC 1:1] Ignoring renegotiation offer in non-stable state:', sigState);
        return;
      }

      console.log('[WebRTC 1:1] Applying renegotiation offer');
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      const otherUserId = this.getOtherUserId();
      const callState = useCallStore.getState();
      if (otherUserId && callState.callId) {
        websocketService.send({
          type: 'webrtc_answer',
          payload: {
            callId: callState.callId,
            toUserId: otherUserId,
            answer: { type: answer.type, sdp: answer.sdp },
          },
        });
        console.log('[WebRTC 1:1] Sent renegotiation answer to', otherUserId);
      }
      this.addPendingIceCandidates();
    } catch (error) {
      console.error('[WebRTC 1:1] Error handling renegotiation offer:', error);
    }
  }

  // Trigger a renegotiation offer (e.g. after enabling video mid-call when no video is negotiated).
  async renegotiate(): Promise<void> {
    if (!this.peerConnection) {return;}
    if ((this.peerConnection.signalingState as string) !== 'stable') {return;}
    try {
      const otherUserId = this.getOtherUserId();
      const callState = useCallStore.getState();
      if (!otherUserId || !callState.callId) {return;}

      const offer = await this.peerConnection.createOffer({});
      await this.peerConnection.setLocalDescription(offer);
      websocketService.send({
        type: 'webrtc_offer',
        payload: {
          callId: callState.callId,
          toUserId: otherUserId,
          offer: { type: offer.type, sdp: offer.sdp },
          callType: callState.callType,
          callerUserId: useAuthStore.getState().user?.id,
          renegotiation: true,
        },
      });
      console.log('[WebRTC 1:1] Sent renegotiation offer (mid-call) to', otherUserId);
    } catch (error) {
      console.error('[WebRTC 1:1] Error renegotiating:', error);
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
      if (!this.peerConnection) {return;}

      const senders = this.peerConnection.getSenders();
      for (const sender of senders) {
        if (sender.track?.kind === 'video') {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 500000; // 500 kbps (optimized for tactical router / RUT200)
          params.encodings[0].maxFramerate = 20;
          await sender.setParameters(params);
          console.log('[WebRTC 1:1] ✅ Video bitrate optimized to 500 kbps (20 fps)');
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
            reason: 'declined',
          },
        });
        console.log('[WebRTC 1:1] Sent reject_call (declined) to caller', otherUserId);
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

    this.clearDisconnectTimer();
    this.iceRestartAttempts = 0;

    // Stop audio session
    InCallManager.stop();
    console.log('[WebRTC 1:1] Audio session stopped');

    // STEP 1: Stop local tracks BEFORE closing the peer connection.
    // Calling peerConnection.close() first would dispose the native track objects,
    // making any subsequent stop() on them throw IllegalStateException.
    const localStream = useCallStore.getState().localStream;
    if (localStream) {
      localStream.getTracks().forEach((track: MediaStreamTrack) => {
        try {
          // Guard: only stop if not already ended to avoid redundant native calls
          if (track.readyState !== 'ended') {
            track.stop();
          }
        } catch (e) {
          console.log('[WebRTC 1:1] Error stopping local track (already stopped?):', e);
        }
        console.log('[WebRTC 1:1] Stopped local track:', track.kind);
      });
      // release() disposes the native camera capturer + SurfaceTextureHelper thread natively
      // NOTE: We MUST NOT call track.release() individually if we are calling stream.release(),
      // as stream.release() automatically attempts to release all its native tracks, causing
      // a double-dispose crash if they are already released.
      try { (localStream as any).release?.(); } catch (e) { /* no-op */ }
    }

    // STEP 2: Stop remote tracks (these are managed by the PC but we mark them ended).
    // No release() needed here — remote tracks are not local capturers.
    const remoteStream = useCallStore.getState().remoteStream;
    if (remoteStream) {
      remoteStream.getTracks().forEach((track: MediaStreamTrack) => {
        try {
          if (track.readyState !== 'ended') {
            track.stop();
          }
        } catch (e) { /* no-op */ }
        console.log('[WebRTC 1:1] Stopped remote track:', track.kind);
      });
    }

    // STEP 3: NOW close the peer connection (after all tracks are safely stopped/released).
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (e) {
        console.log('[WebRTC 1:1] Error closing peer connection:', e);
      }
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

    // Update call store — this ONLY resets Zustand state, no track operations inside
    useCallStore.getState().endCall();

    // Reset initialization flag
    this.isInitializing = false;
  }
}

export const oneOnOneCallService = new OneOnOneCallService();
