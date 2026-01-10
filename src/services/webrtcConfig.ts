import { CallType } from '../store/callStore';

/**
 * WebRTC Configuration
 * Shared configuration for all WebRTC connections
 */

// ICE server configuration
export const ICE_SERVERS = {
  iceServers: [
    // Google's public STUN servers
    {
      urls: 'stun:stun.l.google.com:19302',
    },
    {
      urls: 'stun:stun1.l.google.com:19302',
    },
    {
      urls: 'stun:stun2.l.google.com:19302',
    },
    // Local TURN server (coturn) - use local network IP for real devices
    {
      urls: 'turn:192.168.1.72:3478',
      username: 'test',
      credential: 'test123',
    },
    // Also try UDP and TCP
    {
      urls: 'turn:192.168.1.72:3478?transport=udp',
      username: 'test',
      credential: 'test123',
    },
    {
      urls: 'turn:192.168.1.72:3478?transport=tcp',
      username: 'test',
      credential: 'test123',
    },
  ],
  iceTransportPolicy: 'all' as const,
  iceCandidatePoolSize: 10,
};

// Media constraints for getUserMedia
export const getMediaConstraints = (callType: CallType) => ({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
  },
  video: callType === 'video' ? {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30 },
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
