import { CallType } from '../store/callStore';

/**
 * WebRTC Configuration
 * Shared configuration for all WebRTC connections
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Configurable TURN server defaults
const TURN_USERNAME = 'test';
const TURN_CREDENTIAL = 'test123';

// Get dynamic ICE server configuration
export const getIceServers = async () => {
  let host = 'chat.id';
  try {
    const storedHost = await AsyncStorage.getItem('vcomm_server_host');
    if (storedHost) {
      host = storedHost;
    }
  } catch (error) {
    console.error('Failed to get server host for WebRTC config:', error);
  }

  const turnServer = `${host}:3478`;

  return {
    iceServers: [
      // Google's public STUN servers
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      // TURN server (dynamic)
      { urls: `turn:${turnServer}`, username: TURN_USERNAME, credential: TURN_CREDENTIAL },
      { urls: `turn:${turnServer}?transport=udp`, username: TURN_USERNAME, credential: TURN_CREDENTIAL },
      { urls: `turn:${turnServer}?transport=tcp`, username: TURN_USERNAME, credential: TURN_CREDENTIAL },
    ],
    iceTransportPolicy: 'all' as const,
    iceCandidatePoolSize: 10,
  };
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
    facingMode: 'user',
    width: 1280,
    height: 720,
    frameRate: 30,
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
