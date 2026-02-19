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
  ICE_SERVERS,
  getMediaConstraints,
  getInCallManagerOptions,
  AUDIO_HEALTH_CHECK_INTERVAL,
  STREAM_WAIT_CONFIG
} from './webrtcConfig';

/**
 * GroupCallService
 * Handles WebRTC logic for group calls with multiple participants
 */
export class GroupCallService {
  private groupPeerConnections: Map<number, any> = new Map();
  private groupPendingIceCandidates: Map<number, RTCIceCandidate[]> = new Map();
  private audioHealthCheckInterval: NodeJS.Timeout | null = null;

  // Store for participant streams (to handle tracks coming separately)
  private participantStreams: Map<number, MediaStream> = new Map();

  // Initialize peer connection for a specific participant
  async initializeGroupPeerConnection(participantUserId: number): Promise<any> {
    console.log('[WebRTC Group] Initializing peer connection for participant:', participantUserId);

    // Clean up any existing peer connection for this participant
    if (this.groupPeerConnections.has(participantUserId)) {
      console.log('[WebRTC Group] Cleaning up existing peer connection');
      this.groupPeerConnections.get(participantUserId)?.close();
      this.groupPeerConnections.delete(participantUserId);
    }

    // Initialize or get existing stream for this participant
    if (!this.participantStreams.has(participantUserId)) {
      this.participantStreams.set(participantUserId, new MediaStream());
      console.log('[WebRTC Group] Created new MediaStream for participant:', participantUserId);
    }

    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // Add transceivers upfront to ensure consistent SDP structure across all connections
    // This prevents issues where different peer connections might have different m-line orders
    console.log('[WebRTC Group] Adding transceivers for participant:', participantUserId);

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
        console.log('[WebRTC Group] ICE candidate generated for participant:', participantUserId);
        const callState = useCallStore.getState();
        if (callState.callId) {
          websocketService.send({
            type: 'group_webrtc_ice_candidate',
            payload: {
              callId: callState.callId,
              targetUserId: participantUserId,
              fromUserId: useAuthStore.getState().user?.id,
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
    (peerConnection as any).ontrack = (event: any) => {
      console.log('[WebRTC Group] Remote track received from participant:', participantUserId);
      console.log('[WebRTC Group] Track details:', {
        kind: event.track.kind,
        id: event.track.id,
        enabled: event.track.enabled,
        muted: event.track.muted,
        readyState: event.track.readyState
      });

      // Handle track mute/unmute events for video
      if (event.track.kind === 'video') {
        const initialState = event.track.enabled && !event.track.muted;
        useCallStore.getState().updateParticipantVideo(participantUserId, initialState);

        event.track.onmute = () => {
          console.log('[WebRTC Group] Remote video track muted for participant:', participantUserId);
          useCallStore.getState().updateParticipantVideo(participantUserId, false);
        };

        event.track.onunmute = () => {
          console.log('[WebRTC Group] Remote video track unmuted for participant:', participantUserId);
          useCallStore.getState().updateParticipantVideo(participantUserId, true);
        };

        event.track.onended = () => {
          console.log('[WebRTC Group] Remote video track ended for participant:', participantUserId);
          useCallStore.getState().updateParticipantVideo(participantUserId, false);
        };
      }

      // Always use our participant streams map to avoid stream object replacement (#6)
      let remoteStream = this.participantStreams.get(participantUserId);
      if (!remoteStream) {
        remoteStream = new MediaStream();
        this.participantStreams.set(participantUserId, remoteStream);
      }

      // Add track to existing stream (don't replace the stream object)
      const existingTrack = remoteStream.getTracks().find(t => t.id === event.track.id);
      if (!existingTrack) {
        remoteStream.addTrack(event.track);
        console.log('[WebRTC Group] Added', event.track.kind, 'track to stream for participant:', participantUserId);
      } else {
        console.log('[WebRTC Group] Track already exists in stream for participant:', participantUserId);
      }

      console.log('[WebRTC Group] Setting remote stream for participant:', participantUserId);
      console.log('[WebRTC Group] Remote stream has', remoteStream.getAudioTracks().length, 'audio tracks and', remoteStream.getVideoTracks().length, 'video tracks');
      console.log('[WebRTC Group] Stream ID:', remoteStream.id, 'Active:', remoteStream.active);

      // Update the stream in call store
      useCallStore.getState().updateParticipantStream(participantUserId, remoteStream);
    };

    // Monitor ICE connection state
    (peerConnection as any).oniceconnectionstatechange = () => {
      const timestamp = new Date().toISOString();
      console.log(`[WebRTC Group] [${timestamp}] ICE connection state for participant ${participantUserId}:`, peerConnection.iceConnectionState);

      if (peerConnection.iceConnectionState === 'failed') {
        console.error(`[WebRTC Group] ❌ [${timestamp}] ICE connection FAILED with participant:`, participantUserId);
        console.error('[WebRTC Group] This usually means STUN/TURN servers are not reachable or NAT traversal failed');
      } else if (peerConnection.iceConnectionState === 'disconnected') {
        console.warn(`[WebRTC Group] ⚠️ [${timestamp}] ICE connection DISCONNECTED with participant:`, participantUserId);
        console.warn('[WebRTC Group] Connection may recover or fail completely');
      } else if (peerConnection.iceConnectionState === 'checking') {
        console.log(`[WebRTC Group] 🔍 [${timestamp}] ICE checking connectivity with participant:`, participantUserId);
      } else if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
        console.log(`[WebRTC Group] ✅ [${timestamp}] ICE connection established with participant:`, participantUserId);
        // Update call status to active when first connection is established
        const currentStatus = useCallStore.getState().status;
        if (currentStatus === 'calling') {
          console.log('[WebRTC Group] Setting call status to active');
          useCallStore.getState().setCallStatus('active');
        }
      }
    };

    this.groupPeerConnections.set(participantUserId, peerConnection);
    return peerConnection;
  }

  // Get user media (camera/microphone) — always requests both
  async getUserMedia(callType: CallType): Promise<MediaStream> {
    console.log('[WebRTC Group] Getting user media:', callType);

    // Always request camera + mic permissions (unified call UI)
    const hasPermissions = await requestCameraAndMicrophonePermissions();

    if (!hasPermissions) {
      throw new Error('Camera/Microphone permissions not granted');
    }

    const constraints = getMediaConstraints();

    try {
      const stream = await mediaDevices.getUserMedia(constraints);
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
        currentUserId: currentUser?.id
      });

      // Start audio session — earpiece by default (camera starts off)
      const options = getInCallManagerOptions(callState.callType);
      InCallManager.start(options);
      InCallManager.setForceSpeakerphoneOn(false);
      console.log('[WebRTC Group] Audio session started, speaker: false');

      // Start periodic audio health check
      this.startAudioHealthCheck();

      // Get user media
      console.log('[WebRTC Group] Requesting user media...');
      const stream = await this.getUserMedia(callState.callType);
      console.log('[WebRTC Group] ✅ Got user media, stream ID:', stream.id);

      // Join the group call via WebSocket
      const joinMessage = {
        type: 'join_group_call',
        payload: {
          callId: callState.callId,
          groupId: callState.conversationId,
          conversationId: callState.conversationId,
          fromUserId: currentUser?.id,
        },
      };
      console.log('[WebRTC Group] Sending join_group_call:', joinMessage);
      websocketService.send(joinMessage);

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
      console.log('[WebRTC Group] Creating offer for participant:', participantUserId);

      const localStream = await this.waitForLocalStream();
      if (!localStream) {
        console.error('[WebRTC Group] ❌ Local stream not available, cannot create offer for:', participantUserId);
        return;
      }

      const peerConnection = await this.initializeGroupPeerConnection(participantUserId);

      const isCurrentConnection = () => {
        return this.groupPeerConnections.get(participantUserId) === peerConnection;
      };

      if ((peerConnection.signalingState as any) === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Offer creation skipped (connection replaced or closed) - this is normal during glare');
        return;
      }

      // Add local stream to peer connection using transceivers
      console.log('[WebRTC Group] Setting local tracks to transceivers for:', participantUserId);

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
      // even if the call is audio-only, this ensures consistent SDP structure
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

      const callState = useCallStore.getState();
      const user = useAuthStore.getState().user;

      websocketService.send({
        type: 'group_webrtc_offer',
        payload: {
          callId: callState.callId,
          targetUserId: participantUserId,
          fromUserId: user?.id,
          offer: {
            type: offer.type,
            sdp: offer.sdp,
          },
        },
      });

      console.log('[WebRTC Group] Sent offer to participant:', participantUserId);
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
      console.log('[WebRTC Group] Handling offer from participant:', fromUserId);

      const currentUserId = useAuthStore.getState().user?.id;

      if (fromUserId === currentUserId) {
        console.log('[WebRTC Group] Ignoring offer from self');
        return;
      }

      const localStream = await this.waitForLocalStream();
      if (!localStream) {
        console.error('[WebRTC Group] ❌ Local stream not available, cannot handle offer from:', fromUserId);
        return;
      }

      const existingPeerConnection = this.groupPeerConnections.get(fromUserId);

      // Implement polite peer pattern to handle glare
      if (existingPeerConnection && existingPeerConnection.signalingState !== 'stable') {
        const isPolite = currentUserId! < fromUserId;
        console.log('[WebRTC Group] Glare detected with participant:', fromUserId, 'isPolite:', isPolite, 'state:', existingPeerConnection.signalingState);

        if (!isPolite) {
          console.log('[WebRTC Group] ⏭️ Ignoring offer from participant (impolite peer):', fromUserId);
          return;
        } else {
          console.log('[WebRTC Group] ♻️ Accepting offer from participant (polite peer), closing old connection');
          existingPeerConnection.close();
          this.groupPeerConnections.delete(fromUserId);
        }
      } else if (existingPeerConnection && existingPeerConnection.signalingState === 'stable') {
        console.log('[WebRTC Group] ✅ Connection already stable with participant:', fromUserId, '- accepting renegotiation');
        existingPeerConnection.close();
        this.groupPeerConnections.delete(fromUserId);
      }

      // Create peer connection WITHOUT pre-creating transceivers (answerer mode).
      // setRemoteDescription will create transceivers from the offer's m-lines.
      console.log('[WebRTC Group] Creating answerer peer connection for:', fromUserId);

      // Clean up existing participant stream
      if (!this.participantStreams.has(fromUserId)) {
        this.participantStreams.set(fromUserId, new MediaStream());
      }

      const peerConnection = new RTCPeerConnection(ICE_SERVERS);

      // Set up event handlers (same as initializeGroupPeerConnection but no addTransceiver)
      (peerConnection as any).onicecandidate = (event: any) => {
        if (event.candidate) {
          const callState = useCallStore.getState();
          if (callState.callId) {
            websocketService.send({
              type: 'group_webrtc_ice_candidate',
              payload: {
                callId: callState.callId,
                targetUserId: fromUserId,
                fromUserId: useAuthStore.getState().user?.id,
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

      (peerConnection as any).ontrack = (event: any) => {
        console.log('[WebRTC Group] Remote track received from participant:', fromUserId, event.track.kind);

        if (event.track.kind === 'video') {
          const initialState = event.track.enabled && !event.track.muted;
          useCallStore.getState().updateParticipantVideo(fromUserId, initialState);
          event.track.onmute = () => useCallStore.getState().updateParticipantVideo(fromUserId, false);
          event.track.onunmute = () => useCallStore.getState().updateParticipantVideo(fromUserId, true);
          event.track.onended = () => useCallStore.getState().updateParticipantVideo(fromUserId, false);
        }

        let remoteStream = this.participantStreams.get(fromUserId);
        if (!remoteStream) {
          remoteStream = new MediaStream();
          this.participantStreams.set(fromUserId, remoteStream);
        }
        const existingTrack = remoteStream.getTracks().find(t => t.id === event.track.id);
        if (!existingTrack) {
          remoteStream.addTrack(event.track);
          console.log('[WebRTC Group] Added', event.track.kind, 'track to stream for:', fromUserId);
        }
        console.log('[WebRTC Group] Stream now has', remoteStream.getAudioTracks().length, 'audio,', remoteStream.getVideoTracks().length, 'video tracks');
        useCallStore.getState().updateParticipantStream(fromUserId, remoteStream);
      };

      (peerConnection as any).oniceconnectionstatechange = () => {
        console.log(`[WebRTC Group] ICE state for ${fromUserId}:`, peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
          const currentStatus = useCallStore.getState().status;
          if (currentStatus === 'calling') {
            useCallStore.getState().setCallStatus('active');
          }
        }
      };

      this.groupPeerConnections.set(fromUserId, peerConnection);

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

      const callState = useCallStore.getState();

      websocketService.send({
        type: 'group_webrtc_answer',
        payload: {
          callId: callState.callId,
          targetUserId: fromUserId,
          fromUserId: currentUserId,
          answer: {
            type: answer.type,
            sdp: answer.sdp,
          },
        },
      });

      console.log('[WebRTC Group] ✅ Sent answer to participant:', fromUserId);

      this.addGroupPendingIceCandidates(fromUserId);
    } catch (error) {
      console.error('[WebRTC Group] Error handling offer from participant:', fromUserId, error);
    }
  }

  // Handle group answer from another participant
  async handleGroupAnswer(fromUserId: number, answer: RTCSessionDescription): Promise<void> {
    try {
      console.log('[WebRTC Group] Handling answer from participant:', fromUserId);

      const peerConnection = this.groupPeerConnections.get(fromUserId);
      if (!peerConnection) {
        console.error('[WebRTC Group] No peer connection exists for participant:', fromUserId);
        return;
      }

      // Check if connection is closed (may have been replaced during glare)
      if ((peerConnection.signalingState as string) === 'closed') {
        console.warn('[WebRTC Group] ⚠️ Peer connection is closed, ignoring stale answer from:', fromUserId);
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
        console.warn('[WebRTC Group] Recreating connection and sending new offer to:', fromUserId);
        // Recreate the connection - this will trigger a new offer
        await this.createGroupOffer(fromUserId);
        return;
      }

      if (peerConnection.signalingState === 'have-local-offer') {
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
          console.log('[WebRTC Group] ✅ Remote description set for participant:', fromUserId);
          console.log('[WebRTC Group] Transceivers after setting answer:', peerConnection.getTransceivers().length);

          this.addGroupPendingIceCandidates(fromUserId);
        } catch (setRemoteError: any) {
          console.error('[WebRTC Group] ❌ Error setting remote description (answer):', setRemoteError);

          // Handle transceiver/receiver errors by recreating the connection
          if (setRemoteError?.message?.includes('receiver') || setRemoteError?.message?.includes('transceiver')) {
            console.warn('[WebRTC Group] ⚠️ Transceiver error detected, recreating connection to:', fromUserId);
            await this.createGroupOffer(fromUserId);
            return;
          }

          console.error('[WebRTC Group] Answer SDP:', answer.sdp?.substring(0, 200) + '...');
        }
      } else if (peerConnection.signalingState === 'stable') {
        console.warn('[WebRTC Group] ⚠️ Peer connection already stable, ignoring answer from:', fromUserId);
      } else {
        console.warn('[WebRTC Group] ⚠️ Unexpected signaling state:', peerConnection.signalingState, 'for participant:', fromUserId);
      }
    } catch (error) {
      console.error('[WebRTC Group] Error handling answer from participant:', fromUserId, error);
    }
  }

  // Handle group ICE candidate
  async handleGroupIceCandidate(fromUserId: number, candidate: RTCIceCandidate): Promise<void> {
    try {
      console.log('[WebRTC Group] Handling ICE candidate from participant:', fromUserId);

      const peerConnection = this.groupPeerConnections.get(fromUserId);

      if (peerConnection?.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        if (!this.groupPendingIceCandidates.has(fromUserId)) {
          this.groupPendingIceCandidates.set(fromUserId, []);
        }
        this.groupPendingIceCandidates.get(fromUserId)?.push(candidate);
      }
    } catch (error) {
      console.error('[WebRTC Group] Error handling ICE candidate from participant:', fromUserId, error);
    }
  }

  // Add pending ICE candidates for a participant
  private async addGroupPendingIceCandidates(participantUserId: number): Promise<void> {
    const pendingCandidates = this.groupPendingIceCandidates.get(participantUserId);
    const peerConnection = this.groupPeerConnections.get(participantUserId);

    if (pendingCandidates && pendingCandidates.length > 0 && peerConnection) {
      console.log('[WebRTC Group] Adding', pendingCandidates.length, 'pending ICE candidates for participant:', participantUserId);

      if ((peerConnection.signalingState as any) === 'closed') {
        console.warn('[WebRTC Group] ⚠️ Peer connection is closed, skipping pending candidates for:', participantUserId);
        this.groupPendingIceCandidates.delete(participantUserId);
        return;
      }

      if (!peerConnection.remoteDescription) {
        console.warn('[WebRTC Group] ⚠️ No remote description set yet, keeping candidates pending for:', participantUserId);
        return;
      }

      for (const candidate of pendingCandidates) {
        try {
          if (peerConnection.signalingState !== 'closed') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch (error: any) {
          if (error.toString().includes('closed')) {
            console.error('[WebRTC Group] Error adding pending ICE candidate:', error);
          }
        }
      }

      this.groupPendingIceCandidates.delete(participantUserId);
      console.log('[WebRTC Group] ✅ Finished adding pending candidates for:', participantUserId);
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

    // Stop local stream
    const localStream = useCallStore.getState().localStream;
    if (localStream) {
      localStream.getTracks().forEach((track: MediaStreamTrack) => {
        track.stop();
      });
    }

    // Stop all participant streams
    this.participantStreams.forEach((stream, participantUserId) => {
      console.log('[WebRTC Group] Stopping stream for participant:', participantUserId);
      stream.getTracks().forEach((track: MediaStreamTrack) => {
        track.stop();
      });
    });
    this.participantStreams.clear();

    // Close all peer connections
    this.groupPeerConnections.forEach((peerConnection, participantUserId) => {
      peerConnection.close();
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

    // Update call store
    useCallStore.getState().endCall();
  }
}

export const groupCallService = new GroupCallService();
