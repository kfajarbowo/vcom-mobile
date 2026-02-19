import { CallType } from '../store/callStore';

/**
 * WebRTC Configuration
 * Shared configuration for all WebRTC connections
 */

// Configurable TURN server (#5) - change this for deployment
const TURN_SERVER = '192.168.1.72:3478';
const TURN_USERNAME = 'test';
const TURN_CREDENTIAL = 'test123';

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
    // TURN server (configurable)
    {
      urls: `turn:${TURN_SERVER}`,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    },
    {
      urls: `turn:${TURN_SERVER}?transport=udp`,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    },
    {
      urls: `turn:${TURN_SERVER}?transport=tcp`,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    },
  ],
  iceTransportPolicy: 'all' as const,
  iceCandidatePoolSize: 10,
};

// Media constraints for getUserMedia
// Always request both audio and video — camera starts disabled at the track level
export const getMediaConstraints = () => ({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
  },
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30 },
    facingMode: 'user',
  },
});

// InCallManager options
// Always use 'audio' media type to default to earpiece (phone mode)
// Even for video calls - the unified UI supports video but starts with earpiece
export const getInCallManagerOptions = (callType: CallType) => ({
  media: 'audio' as 'audio' | 'video',
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
