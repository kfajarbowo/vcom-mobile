import {RTCSessionDescription, RTCIceCandidate} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import {CallType, useCallStore} from '../store/callStore';
import {oneOnOneCallService} from './oneOnOneCallService';
import {groupCallService} from './groupCallService';

/**
 * WebRTCService
 * Main coordinator service that delegates to 1-on-1 or group call services
 */
class WebRTCService {
  // ========== 1-ON-1 CALL METHODS ==========

  async startCall(callType: CallType): Promise<void> {
    return oneOnOneCallService.startCall(callType);
  }

  async answerCall(callType: CallType, offer: RTCSessionDescription): Promise<void> {
    return oneOnOneCallService.answerCall(callType, offer);
  }

  async handleAnswer(answer: RTCSessionDescription): Promise<void> {
    return oneOnOneCallService.handleAnswer(answer);
  }

  async handleIceCandidate(candidate: RTCIceCandidate): Promise<void> {
    return oneOnOneCallService.handleIceCandidate(candidate);
  }

  rejectCall(): void {
    oneOnOneCallService.rejectCall();
  }

  endCall(): void {
    oneOnOneCallService.endCall();
  }

  // ========== GROUP CALL METHODS ==========

  async startGroupCall(participantUserIds: number[]): Promise<void> {
    return groupCallService.startGroupCall(participantUserIds);
  }

  async createGroupOffer(participantUserId: number): Promise<void> {
    return groupCallService.createGroupOffer(participantUserId);
  }

  async handleGroupOffer(fromUserId: number, offer: RTCSessionDescription): Promise<void> {
    return groupCallService.handleGroupOffer(fromUserId, offer);
  }

  async handleGroupAnswer(fromUserId: number, answer: RTCSessionDescription): Promise<void> {
    return groupCallService.handleGroupAnswer(fromUserId, answer);
  }

  async handleGroupIceCandidate(fromUserId: number, candidate: RTCIceCandidate): Promise<void> {
    return groupCallService.handleGroupIceCandidate(fromUserId, candidate);
  }

  async addGroupParticipant(participantUserId: number): Promise<void> {
    return groupCallService.addGroupParticipant(participantUserId);
  }

  removeGroupParticipant(participantUserId: number): void {
    groupCallService.removeGroupParticipant(participantUserId);
  }

  endGroupCall(): void {
    groupCallService.endGroupCall();
  }

  // ========== SHARED METHODS ==========

  setSpeakerPhone(enable: boolean): void {
    InCallManager.setForceSpeakerphoneOn(enable);
    console.log('[WebRTC] Speaker:', enable ? 'ON' : 'OFF');
  }

  switchCamera(): void {
    try {
      const { localStream } = useCallStore.getState();
      if (!localStream) {
        console.warn('[WebRTC] Cannot switch camera: no local stream');
        return;
      }

      const videoTrack = localStream.getVideoTracks()[0];
      if (!videoTrack) {
        console.warn('[WebRTC] Cannot switch camera: no video track');
        return;
      }

      // Use react-native-webrtc's built-in camera switch
      (videoTrack as any)._switchCamera();
      console.log('[WebRTC] Camera switched successfully');
    } catch (error) {
      console.error('[WebRTC] Error switching camera:', error);
    }
  }
}

export const webrtcService = new WebRTCService();
