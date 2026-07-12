import { create } from 'zustand';
import { MediaStream } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

export type CallType = 'audio' | 'video';
export type CallStatus = 'idle' | 'calling' | 'ringing' | 'active' | 'ended';

export interface Participant {
  userId: number;
  userName: string;
  stream: MediaStream | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
}

export interface CallState {
  // Call status
  status: CallStatus;
  callId: string | null;
  callType: CallType;
  isIncoming: boolean;

  // Participants
  callerUserId: number | null;
  callerName: string | null;
  receiverUserId: number | null;
  receiverName: string | null;
  conversationId: number | null;

  // WebRTC offer (for incoming calls)
  offer: any | null;

  // Media streams
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;

  // Media controls
  isMuted: boolean;
  isVideoEnabled: boolean;
  isSpeakerEnabled: boolean;
  isRemoteVideoEnabled: boolean;
  isFrontCamera: boolean; // true = front camera, false = back camera

  // Group call support
  isGroupCall: boolean;
  participants: Map<number, Participant>;
  groupName: string | null;

  // Actions
  setCallStatus: (status: CallStatus) => void;
  startCall: (params: {
    callId: string;
    callType: CallType;
    receiverUserId: number;
    receiverName: string;
    conversationId: number;
  }) => void;
  receiveCall: (params: {
    callId: string;
    callType: CallType;
    callerUserId: number;
    callerName: string;
    conversationId: number;
    offer: any;
  }) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  setOffer: (offer: any) => void;
  setCallType: (callType: CallType) => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleSpeaker: () => void;
  switchCamera: () => void;
  setRemoteVideoEnabled: (enabled: boolean) => void;
  endCall: () => void;
  reset: () => void;

  // Group call actions
  startGroupCall: (params: {
    callId: string;
    callType: CallType;
    participantIds: number[];
    conversationId: number;
    groupName: string;
  }) => void;
  receiveGroupCall: (params: {
    callId: string;
    callType: CallType;
    callerUserId: number;
    conversationId: number;
    groupName: string;
    participants: { userId: number; userName: string }[];
  }) => void;
  addParticipant: (userId: number, userName: string, stream?: MediaStream) => void;
  removeParticipant: (userId: number) => void;
  updateParticipantStream: (userId: number, stream: MediaStream) => void;
  updateParticipantAudio: (userId: number, isMuted: boolean) => void;
  updateParticipantVideo: (userId: number, isVideoEnabled: boolean) => void;
  getParticipant: (userId: number) => Participant | undefined;
  getAllParticipants: () => Participant[];
}

const initialState = {
  status: 'idle' as CallStatus,
  callId: null,
  callType: 'audio' as CallType,
  isIncoming: false,
  callerUserId: null,
  callerName: null,
  receiverUserId: null,
  receiverName: null,
  conversationId: null,
  offer: null,
  localStream: null,
  remoteStream: null,
  isMuted: false,
  isVideoEnabled: false,
  isSpeakerEnabled: false,
  isRemoteVideoEnabled: true,
  isFrontCamera: true, // Default to front camera
  isGroupCall: false,
  participants: new Map<number, Participant>(),
  groupName: null,
};

export const useCallStore: any = create<CallState>((set) => ({
  ...initialState,

  setCallStatus: (status) => set({ status }),

  startCall: ({ callId, callType, receiverUserId, receiverName, conversationId }) =>
    set({
      callId,
      callType,
      receiverUserId,
      receiverName,
      conversationId,
      isIncoming: false,
      status: 'calling',
      isVideoEnabled: false,
      isSpeakerEnabled: false,
    }),

  receiveCall: ({ callId, callType, callerUserId, callerName, conversationId, offer }) =>
    set({
      callId,
      callType,
      callerUserId,
      callerName,
      conversationId,
      offer,
      isIncoming: true,
      status: 'ringing',
      isVideoEnabled: callType === 'video', // Enable video for incoming video calls
      isSpeakerEnabled: false,
    }),

  setLocalStream: (stream) => set({ localStream: stream }),

  setRemoteStream: (stream) => set({ remoteStream: stream }),

  setOffer: (offer) => set({ offer }),

  setCallType: (callType) => set({ callType }),

  toggleMute: () =>
    set((state) => {
      const newMuted = !state.isMuted;
      // Optimistic UI: update state immediately, manipulate tracks async (#8)
      if (state.localStream) {
        // track.enabled = true means audio is ON, so when muting we set false
        state.localStream.getAudioTracks().forEach((track) => {
          track.enabled = !newMuted;
        });
      }
      return { isMuted: newMuted };
    }),

  toggleVideo: () =>
    set((state) => {
      if (state.localStream) {
        state.localStream.getVideoTracks().forEach((track) => {
          track.enabled = !state.isVideoEnabled;
        });
      }
      return { isVideoEnabled: !state.isVideoEnabled };
    }),

  toggleSpeaker: () =>
    set((state) => {
      const newSpeakerState = !state.isSpeakerEnabled;
      InCallManager.setForceSpeakerphoneOn(newSpeakerState);
      return { isSpeakerEnabled: newSpeakerState };
    }),

  switchCamera: () =>
    set((state) => {
      // Toggle camera facing mode
      return { isFrontCamera: !state.isFrontCamera };
    }),

  setRemoteVideoEnabled: (enabled: boolean) => set({ isRemoteVideoEnabled: enabled }),

  endCall: () =>
    set(() => {
      // NOTE: Do NOT call track.stop() here.
      // The service layer (oneOnOneCallService / groupCallService) is responsible for stopping
      // and releasing all tracks BEFORE calling this action. Calling stop() here too causes a
      // double-dispose of native MediaStreamTrack objects, which results in:
      //   java.lang.IllegalStateException: MediaStreamTrack has been disposed.
      // This store action only resets the Zustand state references to null.
      return {
        ...initialState,
        status: 'idle',
      };
    }),

  reset: () => set(initialState),

  // Group call actions
  startGroupCall: ({ callId, callType, participantIds, conversationId, groupName }) =>
    set({
      callId,
      callType,
      conversationId,
      groupName,
      isGroupCall: true,
      isIncoming: false,
      status: 'calling',
      isVideoEnabled: false,
      isSpeakerEnabled: false,
      participants: new Map(),
    }),

  receiveGroupCall: ({ callId, callType, callerUserId, conversationId, groupName, participants }) =>
    set((state) => {
      const participantMap = new Map<number, Participant>();
      participants.forEach(({ userId, userName }) => {
        participantMap.set(userId, {
          userId,
          userName,
          stream: null,
          isMuted: false,
          isVideoEnabled: false,
        });
      });

      return {
        callId,
        callType,
        callerUserId,
        conversationId,
        groupName,
        isGroupCall: true,
        isIncoming: true,
        status: 'ringing',
        isVideoEnabled: callType === 'video', // Enable video for incoming video calls
        isSpeakerEnabled: false,
        participants: participantMap,
      };
    }),

  addParticipant: (userId, userName, stream) =>
    set((state) => {
      const newParticipants = new Map(state.participants);
      const existingParticipant = newParticipants.get(userId);

      // If participant exists (e.g., stream arrived first), update their name
      // Otherwise create new participant
      const updatedParticipant = existingParticipant
        ? { ...existingParticipant, userName, stream: stream || existingParticipant.stream }
        : {
          userId,
          userName,
          stream: stream || null,
          isMuted: false,
          isVideoEnabled: false,
        };

      newParticipants.set(userId, updatedParticipant);
      return { participants: newParticipants };
    }),

  removeParticipant: (userId) =>
    set((state) => {
      const newParticipants = new Map(state.participants);
      const participant = newParticipants.get(userId);
      if (participant?.stream) {
        participant.stream.getTracks().forEach((track) => track.stop());
      }
      newParticipants.delete(userId);
      return { participants: newParticipants };
    }),

  updateParticipantStream: (userId, stream) =>
    set((state) => {
      const newParticipants = new Map(state.participants);
      const existingParticipant = newParticipants.get(userId);

      // Create new participant object (not mutate) for proper Zustand change detection
      // Also create participant if they don't exist yet (stream may arrive before participant_joined)
      const updatedParticipant = existingParticipant
        ? { ...existingParticipant, stream }
        : {
          userId,
          userName: '...', // Placeholder until server sends real name
          stream,
          isMuted: false,
          isVideoEnabled: false,
        };

      newParticipants.set(userId, updatedParticipant);
      return { participants: newParticipants };
    }),

  updateParticipantAudio: (userId, isMuted) =>
    set((state) => {
      const newParticipants = new Map(state.participants);
      const participant = newParticipants.get(userId);
      if (participant) {
        // Create new object for proper Zustand change detection
        newParticipants.set(userId, { ...participant, isMuted });
      }
      return { participants: newParticipants };
    }),

  updateParticipantVideo: (userId, isVideoEnabled) =>
    set((state) => {
      const newParticipants = new Map(state.participants);
      const participant = newParticipants.get(userId);
      if (participant) {
        // Create new object for proper Zustand change detection
        newParticipants.set(userId, { ...participant, isVideoEnabled });
      }
      return { participants: newParticipants };
    }),

  getParticipant: (userId) => {
    const state = useCallStore.getState();
    return state.participants.get(userId);
  },

  getAllParticipants: () => {
    const state = useCallStore.getState();
    return Array.from(state.participants.values());
  },
}));
