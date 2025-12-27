import {create} from 'zustand';
import {MediaStream} from 'react-native-webrtc';

export type CallType = 'audio' | 'video';
export type CallStatus = 'idle' | 'calling' | 'ringing' | 'active' | 'ended';

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
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleSpeaker: () => void;
  endCall: () => void;
  reset: () => void;
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
  isSpeakerEnabled: true,
};

export const useCallStore = create<CallState>((set) => ({
  ...initialState,

  setCallStatus: (status) => set({status}),

  startCall: ({callId, callType, receiverUserId, receiverName, conversationId}) =>
    set({
      callId,
      callType,
      receiverUserId,
      receiverName,
      conversationId,
      isIncoming: false,
      status: 'calling',
      isVideoEnabled: callType === 'video',
    }),

  receiveCall: ({callId, callType, callerUserId, callerName, conversationId, offer}) =>
    set({
      callId,
      callType,
      callerUserId,
      callerName,
      conversationId,
      offer,
      isIncoming: true,
      status: 'ringing',
      isVideoEnabled: callType === 'video',
    }),

  setLocalStream: (stream) => set({localStream: stream}),

  setRemoteStream: (stream) => set({remoteStream: stream}),

  toggleMute: () =>
    set((state) => {
      if (state.localStream) {
        state.localStream.getAudioTracks().forEach((track) => {
          track.enabled = state.isMuted;
        });
      }
      return {isMuted: !state.isMuted};
    }),

  toggleVideo: () =>
    set((state) => {
      if (state.localStream) {
        state.localStream.getVideoTracks().forEach((track) => {
          track.enabled = !state.isVideoEnabled;
        });
      }
      return {isVideoEnabled: !state.isVideoEnabled};
    }),

  toggleSpeaker: () =>
    set((state) => {
      const newSpeakerState = !state.isSpeakerEnabled;
      // Import dynamically to avoid circular dependency
      import('../services/webrtcService').then(({webrtcService}) => {
        webrtcService.setSpeakerPhone(newSpeakerState);
      });
      return {isSpeakerEnabled: newSpeakerState};
    }),

  endCall: () =>
    set((state) => {
      // Clean up streams
      state.localStream?.getTracks().forEach((track) => track.stop());
      state.remoteStream?.getTracks().forEach((track) => track.stop());

      return {
        ...initialState,
        status: 'ended',
      };
    }),

  reset: () => set(initialState),
}));
