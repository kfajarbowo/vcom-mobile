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
import {
  getIceServers,
  getMediaConstraints,
  getAudioOnlyConstraints,
  getInCallManagerOptions,
  AUDIO_HEALTH_CHECK_INTERVAL,
  STREAM_WAIT_CONFIG,
} from './webrtcConfig';

/**
 * GroupCallService
 * Handles WebRTC logic for group calls with multiple participants
 */
export class GroupCallService {
  private groupPeerConnections: Map<number, any> = new Map();
  private groupPendingIceCandidates: Map<number, RTCIceCandidate[]> = new Map();
  private audioHealthCheckInterval: NodeJS.Timeout | null = null;
  private groupIceRestartAttempts: Map<number, number> = new Map();
  private static readonly MAX_GROUP_ICE_RESTARTS = 2;

  // Store for participant streams (to handle tracks coming separately)
  private participantStreams: Map<number, MediaStream> = new Map();

  // Initialize peer connection for a specific participant
  async initializeGroupPeerConnection(participantUserId: number): Promise<any> {
    const participantId = Number(participantUserId);
    console.log('[WebRTC Group] Initializing peer connection for participant:', participantId);

    // Clean up any existing peer connection for this participant
    if (this.groupPeerConnections.has(participantId)) {
      console.log('[WebRTC Group] Cleaning up existing peer connection');
      this.groupPeerConnections.get(participantId)?.close();
      this.groupPeerConnections.delete(participantId);
    }

    // Initialize or get existing stream for this participant
    if (!this.participantStreams.has(participantId)) {
      this.participantStreams.set(participantId, new MediaStream());
      console.log('[WebRTC Group] Created new MediaStream for participant:', participantId);
    }

    const iceServers = await getIceServers();
    const peerConnection = new RTCPeerConnection(iceServers as any);

    // Add transceivers upfront to ensure consistent SDP structure across all connections
    // This prevents issues where different peer connections might have different m-line orders
    console.log('[WebRTC Group] Adding transceivers for participant:', participantId);

    // Add audio transceiver with sendrecv direction
    const audioTransceiver = peerConnection.addTransceiver('audio', {
      direction: 'sendrecv',
    });
    console.log('[WebRTC Group] Audio transceiver added:', audioTransceiver.mid);

    // Add video transceiver with sendrecv direction (even for audio-only calls for consistency)
    const videoTransceiver = peerConnection.addTransceiver('video', {
      direction: 'sendrecv',
    });
    console.log('[WebRTC Group] Video transceiver added:', videoTransceiver.mid);

    // Handle ICE candidates
    (peerConnection as any).onicecandidate = (event: any) => {
      if (event.candidate) {
        console.log('[WebRTC Group] ICE candidate generated for participant:', participantId);
        const callState = useCallStore.getState();
        if (callState.callId) {
          const myId = Number(useAuthStore.getState().user?.id);
          const callId = callState.callId;

          const candidateData = {
            candidate: event.candidate.candidate,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            sdpMid: event.candidate.sdpMid,
          };

          websocketService.send({
            type: 'group_webrtc_ice_candidate',
            callId,
            call_id: callId,
            targetUserId: participantId,
            toUserId: participantId,
            to_user_id: participantId,
            recipientId: participantId,
            fromUserId: myId,
            from_user_id: myId,
            candidate: candidateData,
            payload: {
              callId,
              call_id: callId,
              targetUserId: participantId,
              toUserId: participantId,
              to_user_id: participantId,
              recipientId: participantId,
              fromUserId: myId,
              from_user_id: myId,
              candidate: candidateData,
            },
          } as any);
        }
      }
    };

    // Handle remote stream
    (peerConnection as any).ontrack = (event: any) => {
      console.log('[WebRTC Group] Remote track received from participant:', participantId);
      console.log('[WebRTC Group] Track details:', {
        kind: event.track.kind,
        id: event.track.id,
        enabled: event.track.enabled,
        muted: event.track.muted,
        readyState: event.track.readyState,
      });

      // Handle track mute/unmute events for video
      if (event.track.kind === 'video') {
        const initialState = event.track.enabled && !event.track.muted;
        useCallStore.getState().updateParticipantVideo(participantId, initialState);

        event.track.onmute = () => {
          console.log('[WebRTC Group] Remote video track muted for participant:', participantId);
          useCallStore.getState().updateParticipantVideo(participantId, false);
        };

        event.track.onunmute = () => {
          console.log('[WebRTC Group] Remote video track unmuted for participant:', participantId);
          useCallStore.getState().updateParticipantVideo(participantId, true);
        };

        event.track.onended = () => {
          console.log('[WebRTC Group] Remote video track ended for participant:', participantId);
          useCallStore.getState().updateParticipantVideo(participantId, false);
        };
      }

      // Always use our participant streams map to avoid stream object replacement (#6)
      let remoteStream = this.participantStreams.get(participantId);
      if (!remoteStream) {
        remoteStream = new MediaStream();
        this.participantStreams.set(participantId, remoteStream);
      }

      // Add track to existing stream (don't replace the stream object)
      const existingTrack = remoteStream.getTracks().find(t => t.id === event.track.id);
      if (!existingTrack) {
        remoteStream.addTrack(event.track);
        console.log('[WebRTC Group] Added', event.track.kind, 'track to stream for participant:', participantId);
      } else {
        console.log('[WebRTC Group] Track already exists in stream for participant:', participantId);
      }

      console.log('[WebRTC Group] Setting remote stream for participant:', participantId);
      console.log('[WebRTC Group] Remote stream has', remoteStream.getAudioTracks().length, 'audio tracks and', remoteStream.getVideoTracks().length, 'video tracks');
      console.log('[WebRTC Group] Stream ID:', remoteStream.id, 'Active:', remoteStream.active);

      // Update the stream in call store
      useCallStore.getState().updateParticipantStream(participantId, remoteStream);

      // Update call status to active when first track is received if still calling
      const currentStatus = useCallStore.getState().status;
      if (currentStatus === 'calling') {
        console.log('[WebRTC Group] ✅ Track received while calling - transitioning status to active');
        useCallStore.getState().setCallStatus('active');
      }
    };

    // Monitor connection state
    (peerConnection as any).onconnectionstatechange = () => {
      const connState = peerConnection.connectionState;
      console.log(`[WebRTC Group] Connection state with ${participantId}:`, connState);
      if (connState === 'connected') {
        const currentStatus = useCallStore.getState().status;
        if (currentStatus === 'calling') {
          console.log('[WebRTC Group] ✅ Connection established - setting call status to active');
          useCallStore.getState().setCallStatus('active');
        }
      }
    };

    // Monitor ICE connection state
    (peerConnection as any).oniceconnectionstatechange = () => {
      const timestamp = new Date().toISOString();
      console.log(`[WebRTC Group] [${timestamp}] ICE connection state for participant ${participantId}:`, peerConnection.iceConnectionState);

      if (peerConnection.iceConnectionState === 'failed') {
        console.error(`[WebRTC Group] ❌ [${timestamp}] ICE connection FAILED with participant:`, participantId);
        this.attemptGroupIceRecovery(participantId);
      } else if (peerConnection.iceConnectionState === 'disconnected') {
        console.warn(`[WebRTC Group] ⚠️ [${timestamp}] ICE connection DISCONNECTED with participant:`, participantId);
        // Give it a grace window; if still down, attempt recovery.
        setTimeout(() => {
          const pc = this.groupPeerConnections.get(participantId);
          if (pc && (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')) {
            this.attemptGroupIceRecovery(participantId);
          }
        }, 6000);
      } else if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
        this.groupIceRestartAttempts.delete(participantId);
      }
      if (peerConnection.iceConnectionState === 'checking') {
        console.log(`[WebRTC Group] 🔍 [${timestamp}] ICE checking connectivity with participant:`, participantId);
      } else if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
        console.log(`[WebRTC Group] ✅ [${timestamp}] ICE connection established with participant:`, participantId);
        // Update call status to active when first connection is established
        const currentStatus = useCallStore.getState().status;
        if (currentStatus === 'calling') {
          console.log('[WebRTC Group] Setting call status to active');
          useCallStore.getState().setCallStatus('active');
        }
      }
    };

    this.groupPeerConnections.set(participantId, peerConnection);
    return peerConnection;
  }

  // Get user media (camera/microphone) — always requests both
  async getUserMedia(callType: CallType): Promise<MediaStream> {
    console.log('[WebRTC Group] Getting user media:', callType);

    // Always request camera + mic permissions (unified call UI)
    const hasPermissions = await requestCameraAndMicrophonePermissions();

    if (!hasPermissions) {
      throw new Error('Microphone permission not granted');
    }

    try {
      // Try audio+video, fall back to audio-only if the camera is unavailable (denied / busy) so a
      // group voice call still succeeds instead of tearing down.
      let stream: MediaStream;
      try {
        stream = await mediaDevices.getUserMedia(getMediaConstraints(true));
      } catch (videoError) {
        console.warn('[WebRTC Group] getUserMedia with video failed, falling back to audio-only:', videoError);
        stream = await mediaDevices.getUserMedia(getAudioOnlyConstraints());
      }
      console.log('[WebRTC Group] Got user media stream');
      console.log('[WebRTC Group] Stream ID:', stream.id);
      console.log('[WebRTC Group] Audio tracks:', stream.getAudioTracks().length);
      console.log('[WebRTC Group] Video tracks:', stream.getVideoTracks().length);

      // Camera state based on call type:
      // - video calls: camera ON by default
      // - audio calls: camera OFF by default (can be enabled via video button)
      const shouldEnableVideo = callType === 'video';
      stream.getVideoTracks().forEach(track => { track.enabled = shouldEnableVideo; });
      useCallStore.setState({ isVideoEnabled: shouldEnableVideo });

      // Monitor audio track state
      stream.getAudioTracks().forEach((track, index) => {
        console.log(`[WebRTC Group] Audio track ${index}:`, {
          id: track.id,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
      });

      useCallStore.getState().setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('[WebRTC Group] Error getting user media:', error);
      throw error;
    }
  }

  // Wait for local stream to be available
  private async waitForLocalStream(): Promise<MediaStream | null> {
    const { maxRetries, shortDelay, longDelay, shortRetryThreshold } = STREAM_WAIT_CONFIG;

    for (let i = 0; i < maxRetries; i++) {
      const localStream = useCallStore.getState().localStream;
      if (localStream) {
        return localStream;
      }

      const delay = i < shortRetryThreshold ? shortDelay : longDelay;
      console.log(`[WebRTC Group] ⏳ Waiting for local stream (attempt ${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    return null;
  }

  // Start group call
  async startGroupCall(participantUserIds: number[]): Promise<void> {
    try {
      console.log('[WebRTC Group] Starting group call with participants:', participantUserIds);
      const callState = useCallStore.getState();
      const currentUser = useAuthStore.getState().user;

      console.log('[WebRTC Group] Current call state:', {
        callId: callState.callId,
        conversationId: callState.conversationId,
        callType: callState.callType,
        status: callState.status,
        isGroupCall: callState.isGroupCall,
        currentUserId: currentUser?.id,
      });

      // Start audio session. Video calls use the loudspeaker; audio calls the earpiece.
      const options = getInCallManagerOptions(callState.callType);
      InCallManager.start(options);
      const useSpeaker = callState.callType === 'video';
      InCallManager.setForceSpeakerphoneOn(useSpeaker);
      useCallStore.setState({ isSpeakerEnabled: useSpeaker });
      console.log('[WebRTC Group] Audio session started, speaker:', useSpeaker);

      // Start periodic audio health check
      this.startAudioHealthCheck();

      // Get user media
      console.log('[WebRTC Group] Requesting user media...');
      const stream = await this.getUserMedia(callState.callType);
      console.log('[WebRTC Group] ✅ Got user media, stream ID:', stream.id);

      // Join the group call via WebSocket
      const myId = Number(currentUser?.id);
      const callId = callState.callId;
      const convId = callState.conversationId;
      const joinMessage = {
        type: 'join_group_call',
        callId,
        call_id: callId,
        groupId: convId,
        group_id: convId,
        conversationId: convId,
        conversation_id: convId,
        fromUserId: myId,
        from_user_id: myId,
        userId: myId,
        user_id: myId,
        payload: {
          callId,
          call_id: callId,
          groupId: convId,
          group_id: convId,
          conversationId: convId,
          conversation_id: convId,
          fromUserId: myId,
          from_user_id: myId,
          userId: myId,
          user_id: myId,
        },
      };
      console.log('[WebRTC Group] Sending join_group_call:', joinMessage);
      websocketService.send(joinMessage as any);

      console.log('[WebRTC Group] ✅ Successfully sent join_group_call message');
    } catch (error) {
      console.error('[WebRTC Group] ❌ Error starting group call:', error);
      this.endGroupCall();
      throw error;
    }
  }

  // Start periodic audio health check
  private startAudioHealthCheck(): void {
    this.audioHealthCheckInterval = setInterval(() => {
      const localStream = useCallStore.getState().localStream;
      if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach((track: MediaStreamTrack, index: any) => {
          console.log(`[Audio Health] Local track ${index}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
        });
      }

      // Check remote streams
      const participants = useCallStore.getState().participants;
      participants.forEach((participant: any) => {
        if (participant.stream) {
          const audioTracks = participant.stream.getAudioTracks();
          console.log(`[Audio Health] Participant ${participant.userId}: ${audioTracks.length} audio tracks`);
          audioTracks.forEach((track: MediaStreamTrack, index: any) => {
            console.log(`[Audio Health] Remote track ${index}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
          });
        }
      });
    }, AUDIO_HEALTH_CHECK_INTERVAL);
  }

  // Create offer for a specific participant
  async createGroupOffer(participantUserId: number): Promise<void> {
    try {
      const targetId = Number(participantUserId);
      console.log('[WebRTC Group] Creating offer for participant:', targetId);

      const localStream = await this.waitForLocalStream();
      if (!localStream) {
        console.error('[WebRTC Group] ❌ Local stream not available, cannot create offer for:', targetId);
        return;
      }

      const peerConnection = await this.initializeGroupPeerConnection(targetId);

      const isCurrentConnection = () => {
        return this.groupPeerConnections.get(targetId) === peerConnection;
      };

      if ((peerConnection.signalingState as any) === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Offer creation skipped (connection replaced or closed) - this is normal during glare');
        return;
      }

      // Add local stream to peer connection using transceivers
      console.log('[WebRTC Group] Setting local tracks to transceivers for:', targetId);

      const transceivers = peerConnection.getTransceivers();
      console.log('[WebRTC Group] Available transceivers:', transceivers.length);

      // Find audio transceiver (by media kind with index fallback)
      const audioTransceiver = transceivers.find((t: any) => {
        return t.sender?.track?.kind === 'audio' ||
          t.receiver?.track?.kind === 'audio';
      }) || transceivers[0]; // Fallback to first transceiver (audio by convention)

      if (audioTransceiver && localStream.getAudioTracks().length > 0) {
        const audioTrack = localStream.getAudioTracks()[0];
        console.log('[WebRTC Group] Replacing audio track on transceiver:', audioTrack.id, 'enabled:', audioTrack.enabled);
        await audioTransceiver.sender.replaceTrack(audioTrack);
        console.log('[WebRTC Group] Audio track replaced successfully');
      } else if (localStream.getAudioTracks().length > 0) {
        // Fallback: add track if transceiver not found
        const audioTrack = localStream.getAudioTracks()[0];
        console.log('[WebRTC Group] Adding audio track (fallback):', audioTrack.id);
        peerConnection.addTrack(audioTrack, localStream);
      }

      // Find video transceiver (by media kind with index fallback)
      const videoTransceiver = transceivers.find((t: any) => {
        return t.sender?.track?.kind === 'video' ||
          t.receiver?.track?.kind === 'video';
      }) || transceivers[1]; // Fallback to second transceiver (video by convention)

      if (videoTransceiver && localStream.getVideoTracks().length > 0) {
        const videoTrack = localStream.getVideoTracks()[0];
        console.log('[WebRTC Group] Replacing video track on transceiver:', videoTrack.id, 'enabled:', videoTrack.enabled);
        await videoTransceiver.sender.replaceTrack(videoTrack);
        console.log('[WebRTC Group] Video track replaced successfully');
      } else if (localStream.getVideoTracks().length > 0) {
        // Fallback: add track if transceiver not found
        const videoTrack = localStream.getVideoTracks()[0];
        console.log('[WebRTC Group] Adding video track (fallback):', videoTrack.id);
        peerConnection.addTrack(videoTrack, localStream);
      } else {
        console.log('[WebRTC Group] No video track available or video transceiver not found');
      }

      console.log('[WebRTC Group] Total transceivers:', peerConnection.getTransceivers().length);
      console.log('[WebRTC Group] Total senders:', peerConnection.getSenders().length);

      console.log('[WebRTC Group] Creating offer, current state:', peerConnection.signalingState);

      // Always request both audio and video transceivers to prevent mismatch issues
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      if ((peerConnection.signalingState as any) === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Offer creation aborted (connection replaced during glare) - this is expected');
        return;
      }

      await peerConnection.setLocalDescription(offer);
      console.log('[WebRTC Group] ✅ Offer created successfully, signaling state:', peerConnection.signalingState);

      // Set audio bitrate constraints (#5)
      this.applyAudioBitrateConstraints(peerConnection);
      // Boost video bitrate to prevent blurriness on low-end devices
      this.applyVideoBitrateConstraints(peerConnection);

      const callState = useCallStore.getState();
      const user = useAuthStore.getState().user;
      const myId = Number(user?.id);
      const currentCallId = callState.callId;

      const offerData = {
        type: offer.type,
        sdp: offer.sdp,
      };

      websocketService.send({
        type: 'group_webrtc_offer',
        callId: currentCallId,
        call_id: currentCallId,
        targetUserId: targetId,
        toUserId: targetId,
        to_user_id: targetId,
        recipientId: targetId,
        fromUserId: myId,
        from_user_id: myId,
        offer: offerData,
        payload: {
          callId: currentCallId,
          call_id: currentCallId,
          targetUserId: targetId,
          toUserId: targetId,
          to_user_id: targetId,
          recipientId: targetId,
          fromUserId: myId,
          from_user_id: myId,
          offer: offerData,
        },
      } as any);

      console.log('[WebRTC Group] Sent offer to participant:', targetId);
    } catch (error) {
      console.error('[WebRTC Group] Error creating offer for participant:', participantUserId, error);
    }
  }

  // Handle group offer from another participant (answerer side)
  // Key difference from createGroupOffer: we do NOT pre-create transceivers.
  // Instead, setRemoteDescription creates transceivers from the offer's m-lines,
  // then we add local tracks via addTrack which attaches to existing transceivers.
  async handleGroupOffer(fromUserId: number, offer: RTCSessionDescription): Promise<void> {
    try {
      const fromId = Number(fromUserId);
      console.log('[WebRTC Group] Handling offer from participant:', fromId);

      const currentUserId = Number(useAuthStore.getState().user?.id);

      if (fromId === currentUserId) {
        console.log('[WebRTC Group] Ignoring offer from self');
        return;
      }

      const localStream = await this.waitForLocalStream();
      if (!localStream) {
        console.error('[WebRTC Group] ❌ Local stream not available, cannot handle offer from:', fromId);
        return;
      }

      const existingPeerConnection = this.groupPeerConnections.get(fromId);

      // Implement polite peer pattern to handle glare
      if (existingPeerConnection && existingPeerConnection.signalingState !== 'stable') {
        const isPolite = currentUserId < fromId;
        console.log('[WebRTC Group] Glare detected with participant:', fromId, 'isPolite:', isPolite, 'state:', existingPeerConnection.signalingState);

        if (!isPolite) {
          console.log('[WebRTC Group] ⏭️ Ignoring offer from participant (impolite peer):', fromId);
          return;
        } else {
          console.log('[WebRTC Group] ♻️ Accepting offer from participant (polite peer), closing old connection');
          existingPeerConnection.close();
          this.groupPeerConnections.delete(fromId);
        }
      } else if (existingPeerConnection && existingPeerConnection.signalingState === 'stable') {
        console.log('[WebRTC Group] ✅ Connection already stable with participant:', fromId, '- accepting renegotiation');
        existingPeerConnection.close();
        this.groupPeerConnections.delete(fromId);
      }

      // Create peer connection WITHOUT pre-creating transceivers (answerer mode).
      // setRemoteDescription will create transceivers from the offer's m-lines.
      console.log('[WebRTC Group] Creating answerer peer connection for:', fromId);

      // Clean up existing participant stream
      if (!this.participantStreams.has(fromId)) {
        this.participantStreams.set(fromId, new MediaStream());
      }

      const iceServers = await getIceServers();
      const peerConnection = new RTCPeerConnection(iceServers as any);

      // Set up event handlers
      (peerConnection as any).onicecandidate = (event: any) => {
        if (event.candidate) {
          const callState = useCallStore.getState();
          if (callState.callId) {
            const callId = callState.callId;
            const candidateData = {
              candidate: event.candidate.candidate,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              sdpMid: event.candidate.sdpMid,
            };

            websocketService.send({
              type: 'group_webrtc_ice_candidate',
              callId,
              call_id: callId,
              targetUserId: fromId,
              toUserId: fromId,
              to_user_id: fromId,
              recipientId: fromId,
              fromUserId: currentUserId,
              from_user_id: currentUserId,
              candidate: candidateData,
              payload: {
                callId,
                call_id: callId,
                targetUserId: fromId,
                toUserId: fromId,
                to_user_id: fromId,
                recipientId: fromId,
                fromUserId: currentUserId,
                from_user_id: currentUserId,
                candidate: candidateData,
              },
            } as any);
          }
        }
      };

      (peerConnection as any).ontrack = (event: any) => {
        console.log('[WebRTC Group] Remote track received from participant:', fromId, event.track.kind);

        if (event.track.kind === 'video') {
          const initialState = event.track.enabled && !event.track.muted;
          useCallStore.getState().updateParticipantVideo(fromId, initialState);
          event.track.onmute = () => useCallStore.getState().updateParticipantVideo(fromId, false);
          event.track.onunmute = () => useCallStore.getState().updateParticipantVideo(fromId, true);
          event.track.onended = () => useCallStore.getState().updateParticipantVideo(fromId, false);
        }

        let remoteStream = this.participantStreams.get(fromId);
        if (!remoteStream) {
          remoteStream = new MediaStream();
          this.participantStreams.set(fromId, remoteStream);
        }
        const existingTrack = remoteStream.getTracks().find(t => t.id === event.track.id);
        if (!existingTrack) {
          remoteStream.addTrack(event.track);
          console.log('[WebRTC Group] Added', event.track.kind, 'track to stream for:', fromId);
        }
        console.log('[WebRTC Group] Stream now has', remoteStream.getAudioTracks().length, 'audio,', remoteStream.getVideoTracks().length, 'video tracks');
        useCallStore.getState().updateParticipantStream(fromId, remoteStream);

        // Transition status to active when track arrives
        const currentStatus = useCallStore.getState().status;
        if (currentStatus === 'calling') {
          console.log('[WebRTC Group] ✅ Track received while calling - transitioning to active');
          useCallStore.getState().setCallStatus('active');
        }
      };

      (peerConnection as any).onconnectionstatechange = () => {
        const connState = peerConnection.connectionState;
        console.log(`[WebRTC Group] Connection state with ${fromId}:`, connState);
        if (connState === 'connected') {
          const currentStatus = useCallStore.getState().status;
          if (currentStatus === 'calling') {
            console.log('[WebRTC Group] ✅ Connection established - setting call status to active');
            useCallStore.getState().setCallStatus('active');
          }
        }
      };

      (peerConnection as any).oniceconnectionstatechange = () => {
        console.log(`[WebRTC Group] ICE state for ${fromId}:`, peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
          this.groupIceRestartAttempts.delete(fromId);
          const currentStatus = useCallStore.getState().status;
          if (currentStatus === 'calling') {
            useCallStore.getState().setCallStatus('active');
          }
        } else if (peerConnection.iceConnectionState === 'failed') {
          this.attemptGroupIceRecovery(fromId);
        } else if (peerConnection.iceConnectionState === 'disconnected') {
          setTimeout(() => {
            const pc = this.groupPeerConnections.get(fromId);
            if (pc && (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')) {
              this.attemptGroupIceRecovery(fromId);
            }
          }, 6000);
        }
      };

      this.groupPeerConnections.set(fromId, peerConnection);

      // Step 1: Set remote description FIRST — this creates transceivers from the offer's m-lines
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('[WebRTC Group] Remote description set, signaling state:', peerConnection.signalingState);
      } catch (error) {
        console.error('[WebRTC Group] ❌ Error setting remote description:', error);
        return;
      }

      if (peerConnection.signalingState !== 'have-remote-offer') {
        console.error('[WebRTC Group] ❌ Wrong state for answer:', peerConnection.signalingState);
        return;
      }

      // Step 2: Add local tracks via addTrack — WebRTC engine matches them to existing transceivers
      const audioTrack = localStream.getAudioTracks()[0];
      const videoTrack = localStream.getVideoTracks()[0];

      if (audioTrack) {
        peerConnection.addTrack(audioTrack, localStream);
        console.log('[WebRTC Group] Added local audio track:', audioTrack.id, 'enabled:', audioTrack.enabled);
      }
      if (videoTrack) {
        peerConnection.addTrack(videoTrack, localStream);
        console.log('[WebRTC Group] Added local video track:', videoTrack.id, 'enabled:', videoTrack.enabled);
      }

      console.log('[WebRTC Group] Transceivers after adding tracks:', peerConnection.getTransceivers().length);
      console.log('[WebRTC Group] Senders:', peerConnection.getSenders().length);

      // Step 3: Create and send answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      console.log('[WebRTC Group] Answer created, signaling state:', peerConnection.signalingState);

      // Set audio bitrate constraints (#5)
      this.applyAudioBitrateConstraints(peerConnection);
      // Boost video bitrate to prevent blurriness on low-end devices
      this.applyVideoBitrateConstraints(peerConnection);

      const callState = useCallStore.getState();
      const currentCallId = callState.callId;

      const answerData = {
        type: answer.type,
        sdp: answer.sdp,
      };

      websocketService.send({
        type: 'group_webrtc_answer',
        callId: currentCallId,
        call_id: currentCallId,
        targetUserId: fromId,
        toUserId: fromId,
        to_user_id: fromId,
        recipientId: fromId,
        fromUserId: currentUserId,
        from_user_id: currentUserId,
        answer: answerData,
        sdp: answer.sdp,
        payload: {
          callId: currentCallId,
          call_id: currentCallId,
          targetUserId: fromId,
          toUserId: fromId,
          to_user_id: fromId,
          recipientId: fromId,
          fromUserId: currentUserId,
          from_user_id: currentUserId,
          answer: answerData,
          sdp: answer.sdp,
        },
      } as any);

      console.log('[WebRTC Group] ✅ Sent answer to participant:', fromId);

      await this.addGroupPendingIceCandidates(fromId);

      // Safety fallback timer: auto-transition ke active setelah 2.5s jika masih calling
      setTimeout(() => {
        const checkState = useCallStore.getState();
        if (checkState.callId === currentCallId && checkState.status === 'calling') {
          console.log('[WebRTC Group] ⏱️ Answer safety timer: auto-transitioning to active');
          useCallStore.getState().setCallStatus('active');
        }
      }, 2500);
    } catch (error) {
      console.error('[WebRTC Group] Error handling offer from participant:', fromUserId, error);
    }
  }

  // Handle group answer from another participant
  async handleGroupAnswer(fromUserId: number, answer: RTCSessionDescription): Promise<void> {
    try {
      const fromId = Number(fromUserId);
      console.log('[WebRTC Group] Handling answer from participant:', fromId);

      const peerConnection = this.groupPeerConnections.get(fromId);
      if (!peerConnection) {
        console.error('[WebRTC Group] No peer connection exists for participant:', fromId);
        return;
      }

      // Check if connection is closed (may have been replaced during glare)
      if ((peerConnection.signalingState as string) === 'closed') {
        console.warn('[WebRTC Group] ⚠️ Peer connection is closed, ignoring stale answer from:', fromId);
        return;
      }

      console.log('[WebRTC Group] Current signaling state:', peerConnection.signalingState);

      // Validate transceivers before attempting to set remote description
      const transceivers = peerConnection.getTransceivers();
      console.log('[WebRTC Group] Transceivers before setting answer:', transceivers.length);

      // Check for invalid transceivers (can happen if connection was replaced during glare)
      const hasInvalidTransceivers = transceivers.some((t: any) => {
        try {
          return !t || !t.receiver;
        } catch {
          return true;
        }
      });

      if (hasInvalidTransceivers) {
        console.warn('[WebRTC Group] ⚠️ Invalid transceivers detected, connection may have been replaced during glare');
        console.warn('[WebRTC Group] Recreating connection and sending new offer to:', fromId);
        // Recreate the connection - this will trigger a new offer
        await this.createGroupOffer(fromId);
        return;
      }

      if (peerConnection.signalingState === 'have-local-offer') {
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
          console.log('[WebRTC Group] ✅ Remote description set for participant:', fromId);
          console.log('[WebRTC Group] Transceivers after setting answer:', peerConnection.getTransceivers().length);

          await this.addGroupPendingIceCandidates(fromId);
        } catch (setRemoteError: any) {
          console.error('[WebRTC Group] ❌ Error setting remote description (answer):', setRemoteError);

          // Handle transceiver/receiver errors by recreating the connection
          if (setRemoteError?.message?.includes('receiver') || setRemoteError?.message?.includes('transceiver')) {
            console.warn('[WebRTC Group] ⚠️ Transceiver error detected, recreating connection to:', fromId);
            await this.createGroupOffer(fromId);
            return;
          }

          console.error('[WebRTC Group] Answer SDP:', answer.sdp?.substring(0, 200) + '...');
        }
      } else if (peerConnection.signalingState === 'stable') {
        console.warn('[WebRTC Group] ⚠️ Peer connection already stable, ignoring answer from:', fromId);
      } else {
        console.warn('[WebRTC Group] ⚠️ Unexpected signaling state:', peerConnection.signalingState, 'for participant:', fromId);
      }
    } catch (error) {
      console.error('[WebRTC Group] Error handling answer from participant:', fromUserId, error);
    }
  }

  // Handle group ICE candidate
  async handleGroupIceCandidate(fromUserId: number, candidate: any): Promise<void> {
    try {
      if (!candidate) {
        return;
      }
      const fromId = Number(fromUserId);
      console.log('[WebRTC Group] Handling ICE candidate from participant:', fromId);

      const candidateObj = typeof candidate === 'string'
        ? { candidate, sdpMid: '0', sdpMLineIndex: 0 }
        : candidate;

      if (!candidateObj.candidate && candidateObj.candidate !== '') {
        console.warn('[WebRTC Group] Invalid candidate object from participant:', fromId);
        return;
      }

      const peerConnection = this.groupPeerConnections.get(fromId);

      if (peerConnection?.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidateObj));
      } else {
        if (!this.groupPendingIceCandidates.has(fromId)) {
          this.groupPendingIceCandidates.set(fromId, []);
        }
        this.groupPendingIceCandidates.get(fromId)?.push(candidateObj);
      }
    } catch (error) {
      console.error('[WebRTC Group] Error handling ICE candidate from participant:', fromUserId, error);
    }
  }

  // Add pending ICE candidates for a participant
  private async addGroupPendingIceCandidates(participantUserId: number): Promise<void> {
    const participantId = Number(participantUserId);
    const pendingCandidates = this.groupPendingIceCandidates.get(participantId);
    const peerConnection = this.groupPeerConnections.get(participantId);

    if (pendingCandidates && pendingCandidates.length > 0 && peerConnection) {
      console.log('[WebRTC Group] Adding', pendingCandidates.length, 'pending ICE candidates for participant:', participantId);

      if ((peerConnection.signalingState as any) === 'closed') {
        console.warn('[WebRTC Group] ⚠️ Peer connection is closed, skipping pending candidates for:', participantId);
        this.groupPendingIceCandidates.delete(participantId);
        return;
      }

      if (!peerConnection.remoteDescription) {
        console.warn('[WebRTC Group] ⚠️ No remote description set yet, keeping candidates pending for:', participantId);
        return;
      }

      const candidatesToAdd = [...pendingCandidates];
      this.groupPendingIceCandidates.delete(participantId);

      for (const candidate of candidatesToAdd) {
        try {
          if (peerConnection.signalingState !== 'closed') {
            const candidateObj = typeof candidate === 'string'
              ? { candidate, sdpMid: '0', sdpMLineIndex: 0 }
              : candidate;
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidateObj));
          }
        } catch (error: any) {
          if (error.toString().includes('closed')) {
            console.error('[WebRTC Group] Error adding pending ICE candidate:', error);
          }
        }
      }

      console.log('[WebRTC Group] ✅ Finished adding pending candidates for:', participantId);
    }
  }

  // Apply audio bitrate constraints and enable DTX for bandwidth savings (#5)
  private async applyAudioBitrateConstraints(peerConnection: any): Promise<void> {
    try {
      const senders = peerConnection.getSenders();
      for (const sender of senders) {
        if (sender.track?.kind === 'audio') {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 32000; // 32kbps for voice
          // Note: DTX is controlled via SDP Opus parameters, not via setParameters
          await sender.setParameters(params);
          console.log('[WebRTC Group] Audio bitrate set to 32kbps');
        }
      }
    } catch (error) {
      console.error('[WebRTC Group] Error setting audio bitrate:', error);
    }
  }

  // Boost video sender bitrate to prevent blurriness on low-end devices
  private async applyVideoBitrateConstraints(peerConnection: any): Promise<void> {
    try {
      const senders = peerConnection.getSenders();
      for (const sender of senders) {
        if (sender.track?.kind === 'video') {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 1500000; // 1.5 Mbps for clear 720p
          params.encodings[0].maxFramerate = 30;
          await sender.setParameters(params);
          console.log('[WebRTC Group] \u2705 Video bitrate boosted to 1.5 Mbps');
        }
      }
    } catch (error) {
      console.warn('[WebRTC Group] Could not boost video bitrate:', error);
    }
  }

  // Attempt to recover a broken mesh leg. To avoid both peers re-offering simultaneously (glare),
  // only the numerically-lower userId re-offers; the higher one waits for that offer. After the
  // restart budget is exhausted, drop the participant tile so it doesn't sit frozen forever.
  private async attemptGroupIceRecovery(participantUserId: number): Promise<void> {
    const currentUserId = useAuthStore.getState().user?.id;
    if (currentUserId == null) {return;}

    const attempts = this.groupIceRestartAttempts.get(participantUserId) || 0;
    if (attempts >= GroupCallService.MAX_GROUP_ICE_RESTARTS) {
      console.warn('[WebRTC Group] ICE recovery budget exhausted for participant, removing:', participantUserId);
      this.removeGroupParticipant(participantUserId);
      return;
    }
    this.groupIceRestartAttempts.set(participantUserId, attempts + 1);

    // Deterministic initiator so the two peers don't both re-offer at once.
    if (currentUserId < participantUserId) {
      console.log('[WebRTC Group] 🔄 Re-offering to recover ICE with participant:', participantUserId);
      await this.createGroupOffer(participantUserId);
    } else {
      console.log('[WebRTC Group] Waiting for peer to re-offer (they are the recovery initiator):', participantUserId);
    }
  }

  // Add new participant to ongoing group call
  async addGroupParticipant(participantUserId: number): Promise<void> {
    console.log('[WebRTC Group] Adding new participant:', participantUserId);
    await this.createGroupOffer(participantUserId);
  }

  // Remove participant from group call
  removeGroupParticipant(participantUserId: number): void {
    console.log('[WebRTC Group] Removing participant:', participantUserId);

    const peerConnection = this.groupPeerConnections.get(participantUserId);
    if (peerConnection) {
      peerConnection.close();
      this.groupPeerConnections.delete(participantUserId);
    }

    this.groupPendingIceCandidates.delete(participantUserId);
    this.groupIceRestartAttempts.delete(participantUserId);

    // Clean up participant stream
    const stream = this.participantStreams.get(participantUserId);
    if (stream) {
      stream.getTracks().forEach((track: MediaStreamTrack) => {
        track.stop();
      });
      this.participantStreams.delete(participantUserId);
    }

    useCallStore.getState().removeParticipant(participantUserId);
  }

  // End group call
  endGroupCall(): void {
    console.log('[WebRTC Group] Ending group call');

    // Stop audio health check
    if (this.audioHealthCheckInterval) {
      clearInterval(this.audioHealthCheckInterval);
      this.audioHealthCheckInterval = null;
    }

    // Stop audio session
    InCallManager.stop();

    this.groupIceRestartAttempts.clear();

    // STEP 1: Stop local stream BEFORE closing peer connections.
    const localStream = useCallStore.getState().localStream;
    if (localStream) {
      localStream.getTracks().forEach((track: MediaStreamTrack) => {
        try {
          if (track.readyState !== 'ended') {
            track.stop();
          }
        } catch (e) { /* no-op */ }
      });
      // ONLY release the stream, which will natively clean up the capturer and its tracks.
      // Do not call track.release() individually to avoid double-dispose.
      try { (localStream as any).release?.(); } catch (e) { /* no-op */ }
    }

    // STEP 2: Stop all participant (remote) streams.
    // No release() needed — these are remote tracks, not local capturers.
    this.participantStreams.forEach((stream, participantUserId) => {
      console.log('[WebRTC Group] Stopping stream for participant:', participantUserId);
      stream.getTracks().forEach((track: MediaStreamTrack) => {
        try {
          if (track.readyState !== 'ended') {
            track.stop();
          }
        } catch (e) { /* no-op */ }
      });
    });
    this.participantStreams.clear();

    // STEP 3: NOW close all peer connections (after all tracks are safely stopped).
    this.groupPeerConnections.forEach((peerConnection, participantUserId) => {
      try {
        peerConnection.close();
      } catch (e) {
        console.log('[WebRTC Group] Error closing PC for participant', participantUserId, ':', e);
      }
    });
    this.groupPeerConnections.clear();
    this.groupPendingIceCandidates.clear();

    // Notify via WebSocket
    const callState = useCallStore.getState();
    if (callState.callId) {
      websocketService.send({
        type: 'leave_group_call',
        payload: {
          callId: callState.callId,
          groupId: callState.conversationId,
          fromUserId: useAuthStore.getState().user?.id,
        },
      });
    }

    // Update call store — this ONLY resets Zustand state, no track operations inside
    useCallStore.getState().endCall();
  }
}

export const groupCallService = new GroupCallService();
