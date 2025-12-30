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
  // For 1-on-1 calls
  private peerConnection: RTCPeerConnection | null = null;
  private pendingIceCandidates: RTCIceCandidate[] = [];

  // For group calls
  private groupPeerConnections: Map<number, RTCPeerConnection> = new Map();
  private groupPendingIceCandidates: Map<number, RTCIceCandidate[]> = new Map();

  // Initialize peer connection
  async initializePeerConnection(): Promise<void> {
    console.log('[WebRTC] Initializing peer connection');

    // Clean up any existing peer connection first
    if (this.peerConnection) {
      console.log('[WebRTC] Cleaning up existing peer connection before creating new one');
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:192.168.100.79:3478',
        },
        {
          urls: 'turn:192.168.100.79:3478',
          username: 'test',
          credential: 'test123',
        },
      ],
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10,
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

        // Monitor local track state changes
        track.onended = () => {
          console.error('[WebRTC] ❌ LOCAL audio track ENDED unexpectedly!');
        };
        track.onmute = () => {
          console.warn('[WebRTC] ⚠️ LOCAL audio track MUTED');
        };
        track.onunmute = () => {
          console.log('[WebRTC] ✅ LOCAL audio track UNMUTED');
        };
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
      const offerMessage = {
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
      };

      console.log('[WebRTC] Sending webrtc_offer with data:', {
        callId: callState.callId,
        callType: callState.callType,
        callerUserId: user?.id,
        callerName: user?.callsign || user?.username,
        conversationId: callState.conversationId,
        hasOffer: !!offer
      });

      websocketService.send(offerMessage);

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

    // Stop all local tracks
    const localStream = useCallStore.getState().localStream;
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        track.stop();
        console.log('[WebRTC] Stopped local track:', track.kind);
      });
    }

    // Stop all remote tracks
    const remoteStream = useCallStore.getState().remoteStream;
    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => {
        track.stop();
        console.log('[WebRTC] Stopped remote track:', track.kind);
      });
    }

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
      console.log('[WebRTC] Peer connection closed and cleared');
    }

    // Clear pending candidates
    this.pendingIceCandidates = [];

    // Get call state BEFORE clearing it
    const callState = useCallStore.getState();
    const callId = callState.callId;
    const toUserId = callState.isIncoming
      ? callState.callerUserId
      : callState.receiverUserId;

    // Notify via WebSocket BEFORE clearing state
    if (callId && toUserId) {
      websocketService.send({
        type: 'end_call',
        payload: {
          callId,
          toUserId,
        },
      });
      console.log('[WebRTC] Sent end_call to user', toUserId);
    }

    // Update call store (clears callId and user IDs)
    useCallStore.getState().endCall();
  }

  // Toggle speaker (for use with speaker button)
  setSpeakerPhone(enable: boolean): void {
    InCallManager.setForceSpeakerphoneOn(enable);
    console.log('[WebRTC] Speaker:', enable ? 'ON' : 'OFF');
  }

  // ========== GROUP CALL METHODS ==========

  // Initialize peer connection for a specific participant
  async initializeGroupPeerConnection(participantUserId: number): Promise<RTCPeerConnection> {
    console.log('[WebRTC Group] Initializing peer connection for participant:', participantUserId);

    // Clean up any existing peer connection for this participant
    if (this.groupPeerConnections.has(participantUserId)) {
      console.log('[WebRTC Group] Cleaning up existing peer connection');
      this.groupPeerConnections.get(participantUserId)?.close();
      this.groupPeerConnections.delete(participantUserId);
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:192.168.100.79:3478',
        },
        {
          urls: 'turn:192.168.100.79:3478',
          username: 'test',
          credential: 'test123',
        },
      ],
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10,
    });

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
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
    peerConnection.ontrack = (event) => {
      console.log('[WebRTC Group] Remote track received from participant:', participantUserId);
      console.log('[WebRTC Group] Track details:', {
        kind: event.track.kind,
        id: event.track.id,
        enabled: event.track.enabled,
        muted: event.track.muted,
        readyState: event.track.readyState
      });

      // Monitor track state changes
      event.track.onended = () => {
        console.warn('[WebRTC Group] ⚠️ Remote track ENDED for participant:', participantUserId, 'kind:', event.track.kind);
      };
      event.track.onmute = () => {
        console.warn('[WebRTC Group] ⚠️ Remote track MUTED for participant:', participantUserId, 'kind:', event.track.kind);
      };
      event.track.onunmute = () => {
        console.log('[WebRTC Group] ✅ Remote track UNMUTED for participant:', participantUserId, 'kind:', event.track.kind);
      };

      if (event.streams && event.streams[0]) {
        const remoteStream = event.streams[0];
        console.log('[WebRTC Group] Setting remote stream for participant:', participantUserId);
        console.log('[WebRTC Group] Remote stream has', remoteStream.getAudioTracks().length, 'audio tracks and', remoteStream.getVideoTracks().length, 'video tracks');
        useCallStore.getState().updateParticipantStream(participantUserId, remoteStream);
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      const timestamp = new Date().toISOString();
      console.log(`[WebRTC Group] [${timestamp}] Connection state changed for participant ${participantUserId}:`, peerConnection.connectionState);

      if (peerConnection.connectionState === 'connected') {
        console.log('[WebRTC Group] ✅ Connection established with participant:', participantUserId);
        // Update call status to active when first connection is established
        const currentStatus = useCallStore.getState().status;
        if (currentStatus === 'calling') {
          console.log('[WebRTC Group] Setting call status to active');
          useCallStore.getState().setCallStatus('active');
        }
      } else if (peerConnection.connectionState === 'failed') {
        console.error(`[WebRTC Group] ❌ [${timestamp}] Connection FAILED with participant:`, participantUserId);
      } else if (peerConnection.connectionState === 'disconnected') {
        console.warn(`[WebRTC Group] ⚠️ [${timestamp}] Connection DISCONNECTED with participant:`, participantUserId);
      }
    };

    // Monitor ICE connection state (more detailed than connection state)
    peerConnection.oniceconnectionstatechange = () => {
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
      }
    };

    this.groupPeerConnections.set(participantUserId, peerConnection);
    return peerConnection;
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
      InCallManager.start({
        media: callState.callType === 'video' ? 'video' : 'audio',
        auto: true,
        ringback: '',
      });
      InCallManager.setForceSpeakerphoneOn(true);
      console.log('[WebRTC Group] Audio session started with speaker enabled');

      // Start periodic audio health check
      const audioHealthCheck = setInterval(() => {
        const localStream = useCallStore.getState().localStream;
        if (localStream) {
          const audioTracks = localStream.getAudioTracks();
          audioTracks.forEach((track, index) => {
            console.log(`[Audio Health] Local track ${index}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
          });
        }

        // Check remote streams
        const participants = useCallStore.getState().participants;
        participants.forEach((participant) => {
          if (participant.stream) {
            const audioTracks = participant.stream.getAudioTracks();
            console.log(`[Audio Health] Participant ${participant.userId}: ${audioTracks.length} audio tracks`);
            audioTracks.forEach((track, index) => {
              console.log(`[Audio Health] Remote track ${index}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
            });
          }
        });
      }, 5000); // Check every 5 seconds

      // Store interval ID for cleanup
      (this as any).audioHealthCheckInterval = audioHealthCheck;

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

  // Create offer for a specific participant
  async createGroupOffer(participantUserId: number): Promise<void> {
    try {
      console.log('[WebRTC Group] Creating offer for participant:', participantUserId);

      // Wait for local stream to be available BEFORE creating peer connection
      const localStream = await this.waitForLocalStream();
      if (!localStream) {
        console.error('[WebRTC Group] ❌ Local stream not available, cannot create offer for:', participantUserId);
        return;
      }

      // Now create peer connection - only once, after we have the stream
      const peerConnection = await this.initializeGroupPeerConnection(participantUserId);

      // Helper function to check if this is still the current connection
      const isCurrentConnection = () => {
        return this.groupPeerConnections.get(participantUserId) === peerConnection;
      };

      // Validate connection state before proceeding
      if (peerConnection.signalingState === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Offer creation skipped (connection replaced or closed) - this is normal during glare');
        return;
      }

      // Add local stream to peer connection
      console.log('[WebRTC Group] Adding local tracks to peer connection for:', participantUserId);
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      console.log('[WebRTC Group] Creating offer, current state:', peerConnection.signalingState);

      // Create offer
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: useCallStore.getState().callType === 'video',
      });

      // Validate connection is still valid before setting local description
      if (peerConnection.signalingState === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Offer creation aborted (connection replaced during glare) - this is expected');
        return;
      }

      await peerConnection.setLocalDescription(offer);
      console.log('[WebRTC Group] ✅ Offer created successfully, signaling state:', peerConnection.signalingState);

      const callState = useCallStore.getState();
      const user = useAuthStore.getState().user;

      // Send offer via WebSocket
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

  // Wait for local stream to be available
  private async waitForLocalStream(maxRetries = 10): Promise<MediaStream | null> {
    for (let i = 0; i < maxRetries; i++) {
      const localStream = useCallStore.getState().localStream;
      if (localStream) {
        return localStream;
      }

      const delay = i < 5 ? 500 : 1000;
      console.log(`[WebRTC Group] ⏳ Waiting for local stream (attempt ${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    return null;
  }

  // Handle group offer from another participant
  async handleGroupOffer(fromUserId: number, offer: RTCSessionDescription): Promise<void> {
    try {
      console.log('[WebRTC Group] Handling offer from participant:', fromUserId);

      const currentUserId = useAuthStore.getState().user?.id;

      // Ignore offers from ourselves (shouldn't happen, but just in case)
      if (fromUserId === currentUserId) {
        console.log('[WebRTC Group] Ignoring offer from self');
        return;
      }

      // Wait for local stream to be available BEFORE creating peer connection
      const localStream = await this.waitForLocalStream();
      if (!localStream) {
        console.error('[WebRTC Group] ❌ Local stream not available, cannot handle offer from:', fromUserId);
        return;
      }

      // Check if peer connection already exists
      const existingPeerConnection = this.groupPeerConnections.get(fromUserId);

      // Implement polite peer pattern to handle glare
      // If both sides send offers simultaneously, the one with lower userId becomes polite (accepts offer)
      // and the one with higher userId becomes impolite (ignores offer and waits for answer to their offer)
      if (existingPeerConnection && existingPeerConnection.signalingState !== 'stable') {
        const isPolite = currentUserId! < fromUserId;
        console.log('[WebRTC Group] Glare detected with participant:', fromUserId, 'isPolite:', isPolite, 'state:', existingPeerConnection.signalingState);

        if (!isPolite) {
          console.log('[WebRTC Group] ⏭️ Ignoring offer from participant (impolite peer):', fromUserId);
          return;
        } else {
          console.log('[WebRTC Group] ♻️ Accepting offer from participant (polite peer), closing old connection');
          // Close existing connection and create new one
          existingPeerConnection.close();
          this.groupPeerConnections.delete(fromUserId);
        }
      } else if (existingPeerConnection && existingPeerConnection.signalingState === 'stable') {
        console.log('[WebRTC Group] ✅ Connection already stable with participant:', fromUserId);
        return;
      }

      // Now create peer connection - only once, after we have the stream
      const peerConnection = await this.initializeGroupPeerConnection(fromUserId);

      // Helper function to check if this is still the current connection
      const isCurrentConnection = () => {
        return this.groupPeerConnections.get(fromUserId) === peerConnection;
      };

      // Validate connection state before proceeding
      if (peerConnection.signalingState === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Answer creation skipped (connection replaced) - normal during glare handling');
        return;
      }

      // Add local stream to peer connection
      console.log('[WebRTC Group] Adding local tracks to peer connection for:', fromUserId);
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      // Validate connection is still current and open before setting remote description
      if (peerConnection.signalingState === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Answer aborted (connection replaced) - normal during glare');
        return;
      }

      // Set remote description
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('[WebRTC Group] Remote description set, signaling state:', peerConnection.signalingState);
      } catch (error) {
        console.error('[WebRTC Group] ❌ Error setting remote description:', error);
        return;
      }

      // Validate state before creating answer
      if (peerConnection.signalingState === 'closed' || !isCurrentConnection()) {
        console.log('[WebRTC Group] ℹ️ Answer aborted after remote description (connection replaced)');
        return;
      }
      if (peerConnection.signalingState !== 'have-remote-offer') {
        console.error('[WebRTC Group] ❌ Wrong state for answer:', peerConnection.signalingState);
        return;
      }

      // Create answer
      const answer = await peerConnection.createAnswer();

      // Validate connection is still current and open before setting local description
      if (peerConnection.signalingState === 'closed' || !isCurrentConnection()) {
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

      // Send answer via WebSocket
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

      // Add any pending ICE candidates
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

      // Only set remote description if we're in the correct state
      if (peerConnection.signalingState === 'have-local-offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('[WebRTC Group] ✅ Remote description set for participant:', fromUserId);

        // Add any pending ICE candidates
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
        // Queue candidates until remote description is set
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

      // Validate peer connection state
      if (peerConnection.signalingState === 'closed') {
        console.warn('[WebRTC Group] ⚠️ Peer connection is closed, skipping pending candidates for:', participantUserId);
        this.groupPendingIceCandidates.delete(participantUserId);
        return;
      }

      // Ensure remote description is set before adding candidates
      if (!peerConnection.remoteDescription) {
        console.warn('[WebRTC Group] ⚠️ No remote description set yet, keeping candidates pending for:', participantUserId);
        return;
      }

      for (const candidate of pendingCandidates) {
        try {
          // Double-check connection state before each candidate
          if (peerConnection.signalingState !== 'closed') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch (error) {
          // Only log if it's not a "connection closed" error
          if (!error.toString().includes('closed')) {
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
    // Create offer to new participant
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
    if ((this as any).audioHealthCheckInterval) {
      clearInterval((this as any).audioHealthCheckInterval);
      (this as any).audioHealthCheckInterval = null;
    }

    // Stop audio session
    InCallManager.stop();

    // Stop local stream
    const localStream = useCallStore.getState().localStream;
    if (localStream) {
      localStream.getTracks().forEach((track) => {
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

export const webrtcService = new WebRTCService();
