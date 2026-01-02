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

  // Initialize peer connection for a specific participant
  async initializeGroupPeerConnection(participantUserId: number): Promise<any> {
    console.log('[WebRTC Group] Initializing peer connection for participant:', participantUserId);

    // Clean up any existing peer connection for this participant
    if (this.groupPeerConnections.has(participantUserId)) {
      console.log('[WebRTC Group] Cleaning up existing peer connection');
      this.groupPeerConnections.get(participantUserId)?.close();
      this.groupPeerConnections.delete(participantUserId);
    }

    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

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

      if (event.streams && event.streams[0]) {
        const remoteStream = event.streams[0];
        console.log('[WebRTC Group] Setting remote stream for participant:', participantUserId);
        console.log('[WebRTC Group] Remote stream has', remoteStream.getAudioTracks().length, 'audio tracks and', remoteStream.getVideoTracks().length, 'video tracks');
        useCallStore.getState().updateParticipantStream(participantUserId, remoteStream);
      }
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

  // Get user media (camera/microphone)
  async getUserMedia(callType: CallType): Promise<MediaStream> {
    console.log('[WebRTC Group] Getting user media:', callType);

    const hasPermissions = callType === 'video'
      ? await requestCameraAndMicrophonePermissions()
      : await requestMicrophonePermission();

    if (!hasPermissions) {
      throw new Error('Camera/Microphone permissions not granted');
    }

    const constraints = getMediaConstraints(callType);

    try {
      const stream = await mediaDevices.getUserMedia(constraints);
      console.log('[WebRTC Group] Got user media stream');
      console.log('[WebRTC Group] Stream ID:', stream.id);
      console.log('[WebRTC Group] Audio tracks:', stream.getAudioTracks().length);
      console.log('[WebRTC Group] Video tracks:', stream.getVideoTracks().length);

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
    const {maxRetries, shortDelay, longDelay, shortRetryThreshold} = STREAM_WAIT_CONFIG;

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

      // Start audio session
      const options = getInCallManagerOptions(callState.callType);
      InCallManager.start(options);
      InCallManager.setForceSpeakerphoneOn(true);
      console.log('[WebRTC Group] Audio session started with speaker enabled');

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

      // Add local stream to peer connection in consistent order (audio first, then video)
      console.log('[WebRTC Group] Adding local tracks to peer connection for:', participantUserId);

      // Add audio tracks first
      localStream.getAudioTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      // Then add video tracks
      localStream.getVideoTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      console.log('[WebRTC Group] Creating offer, current state:', peerConnection.signalingState);

      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: useCallStore.getState().callType === 'video',
      });

      if ((peerConnection.signalingState as any) === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Offer creation aborted (connection replaced during glare) - this is expected');
        return;
      }

      await peerConnection.setLocalDescription(offer);
      console.log('[WebRTC Group] ✅ Offer created successfully, signaling state:', peerConnection.signalingState);

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

  // Handle group offer from another participant
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
        console.log('[WebRTC Group] ✅ Connection already stable with participant:', fromUserId);
        return;
      }

      const peerConnection = await this.initializeGroupPeerConnection(fromUserId);

      const isCurrentConnection = () => {
        return this.groupPeerConnections.get(fromUserId) === peerConnection;
      };

      if ((peerConnection.signalingState as any) === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Answer creation skipped (connection replaced) - normal during glare handling');
        return;
      }

      // Add local stream to peer connection in consistent order (audio first, then video)
      console.log('[WebRTC Group] Adding local tracks to peer connection for:', fromUserId);

      // Add audio tracks first
      localStream.getAudioTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      // Then add video tracks
      localStream.getVideoTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      if ((peerConnection.signalingState as any) === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Answer aborted (connection replaced) - normal during glare');
        return;
      }

      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('[WebRTC Group] Remote description set, signaling state:', peerConnection.signalingState);
      } catch (error) {
        console.error('[WebRTC Group] ❌ Error setting remote description:', error);
        return;
      }

      if ((peerConnection.signalingState as any) === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Answer aborted after remote description (connection replaced)');
        return;
      }
      if (peerConnection.signalingState !== 'have-remote-offer') {
        console.error('[WebRTC Group] ❌ Wrong state for answer:', peerConnection.signalingState);
        return;
      }

      const answer = await peerConnection.createAnswer();

      if ((peerConnection.signalingState as any) === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Answer aborted before local description (connection replaced)');
        return;
      }

      try {
        await peerConnection.setLocalDescription(answer);
        console.log('[WebRTC Group] Answer created, signaling state:', peerConnection.signalingState);
      } catch (error) {
        console.error('[WebRTC Group] ❌ Error setting local description:', error);
        return;
      }

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

      console.log('[WebRTC Group] Sent answer to participant:', fromUserId);

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

      console.log('[WebRTC Group] Current signaling state:', peerConnection.signalingState);

      if (peerConnection.signalingState === 'have-local-offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('[WebRTC Group] ✅ Remote description set for participant:', fromUserId);

        this.addGroupPendingIceCandidates(fromUserId);
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
        },
      });
    }

    // Update call store
    useCallStore.getState().endCall();
  }
}

export const groupCallService = new GroupCallService();
