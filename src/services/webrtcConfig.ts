import { CallType } from '../store/callStore';

/**
 * WebRTC Configuration
 * Shared configuration for all WebRTC connections
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveHostname } from '../utils/dnsMap';

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

  // TURN dihubungi lewat IP juga: tanpa server DNS, `turn:chat.id:3478` tidak
  // bisa di-resolve dan seluruh kandidat relay gagal terbentuk.
  host = await resolveHostname(host);

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

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: { ideal: 48000 },
  channelCount: { ideal: 1 },
};

const VIDEO_CONSTRAINTS = {
  facingMode: 'user',
  width: 1280,
  height: 720,
  frameRate: 30,
};

// Media constraints for getUserMedia. `withVideo` lets callers fall back to audio-only when the
// camera is unavailable (denied / in use by another app) so a voice call still succeeds.
export const getMediaConstraints = (withVideo: boolean = true) => ({
  audio: AUDIO_CONSTRAINTS,
  video: withVideo ? VIDEO_CONSTRAINTS : false,
});

// Audio-only constraints (no camera acquisition at all).
export const getAudioOnlyConstraints = () => ({
  audio: AUDIO_CONSTRAINTS,
  video: false,
});

// InCallManager options. Video calls route to the loudspeaker and disable the proximity sensor
// (media:'video'); audio calls default to the earpiece (media:'audio'). Using 'audio' for video
// calls previously routed remote audio to the near-inaudible earpiece and blanked the screen when
// the proximity sensor was covered.
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
