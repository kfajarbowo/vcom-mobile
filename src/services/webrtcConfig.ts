import {CallType} from '../store/callStore';

/**
 * WebRTC Configuration
 * Shared configuration for all WebRTC connections
 */

// ICE server configuration
export const ICE_SERVERS = {
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
  iceTransportPolicy: 'all' as const,
  iceCandidatePoolSize: 10,
};

// Media constraints for getUserMedia
export const getMediaConstraints = (callType: CallType) => ({
  audio: true,
  video: callType === 'video' ? {
    width: 640,
    height: 480,
    frameRate: 30,
    facingMode: 'user',
  } : false,
});

// InCallManager options
export const getInCallManagerOptions = (callType: CallType) => ({
  media: (callType === 'video' ? 'video' : 'audio') as 'audio' | 'video',
  auto: true,
  ringback: '',
});

// Audio health check interval (in milliseconds)
export const AUDIO_HEALTH_CHECK_INTERVAL = 5000;

// Stream wait configuration
export const STREAM_WAIT_CONFIG = {
  maxRetries: 10,
  shortDelay: 500,
  longDelay: 1000,
  shortRetryThreshold: 5,
};
