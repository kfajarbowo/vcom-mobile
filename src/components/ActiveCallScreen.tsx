import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useCallStore } from '../store/callStore';
import { webrtcService } from '../services/webrtcService';

export function ActiveCallScreen() {
  const {
    status,
    callType,
    callerName,
    receiverName,
    isIncoming,
    localStream,
    remoteStream,
    isMuted,
    isVideoEnabled,
    isSpeakerEnabled,
    isRemoteVideoEnabled,
    isFrontCamera,
    isGroupCall,
    toggleMute,
    toggleVideo,
    toggleSpeaker,
    switchCamera,
  } = useCallStore();

  const [callDuration, setCallDuration] = useState(0);

  const isVisible = (status === 'calling' || status === 'active') && !isGroupCall;
  const displayName = isIncoming ? callerName : receiverName;

  // Debug: Log stream status
  useEffect(() => {
    console.log('[ActiveCallScreen] Stream status:', {
      hasLocalStream: !!localStream,
      hasRemoteStream: !!remoteStream,
      callType,
      isVideoEnabled,
    });
  }, [localStream, remoteStream, callType, isVideoEnabled]);

  // Call duration timer
  useEffect(() => {
    if (status === 'active') {
      const interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);

      return () => clearInterval(interval);
    } else {
      setCallDuration(0);
    }
  }, [status]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    // Call the appropriate end method based on call type
    if (isGroupCall) {
      webrtcService.endGroupCall();
    } else {
      webrtcService.endCall();
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleEndCall}>
      <View style={styles.container}>
        {/* Remote Video/Avatar */}
        <View style={styles.remoteVideoContainer}>
          {remoteStream && isRemoteVideoEnabled ? (
            <RTCView
              streamURL={remoteStream.toURL()}
              style={styles.remoteVideo}
              objectFit="cover"
              mirror={false}
            />
          ) : (
            <View style={styles.avatarContainer}>
              <MaterialCommunityIcons
                name="account"
                size={120}
                color="#a6c455"
              />
            </View>
          )}

          {/* Call Info Overlay */}
          <View style={styles.callInfoOverlay}>
            <Text style={styles.displayName}>
              {displayName?.toUpperCase() || 'UNKNOWN'}
            </Text>
            <View style={styles.statusContainer}>
              {status === 'calling' ? (
                <>
                  <View style={styles.pulsingDot} />
                  <Text style={styles.statusText}>CONNECTING...</Text>
                </>
              ) : (
                <Text style={styles.statusText}>{formatDuration(callDuration)}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Local Video PiP — always shown, camera starts off */}
        <View style={styles.localVideoContainer} pointerEvents="box-none">
          {isVideoEnabled && localStream ? (
            <RTCView
              key={`local-${localStream.id}`}
              streamURL={localStream.toURL()}
              style={styles.localVideo}
              objectFit="cover"
              mirror={isFrontCamera}
              zOrder={1}
            />
          ) : (
            <View style={styles.localVideoPlaceholder}>
              <MaterialCommunityIcons
                name="account"
                size={60}
                color="#4d5d30"
              />
            </View>
          )}
        </View>

        {/* Call Controls */}
        <View style={styles.controls}>
          {/* Top row: secondary actions */}
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[styles.controlButtonSmall, isSpeakerEnabled && styles.controlButtonActive]}
              onPress={toggleSpeaker}>
              <MaterialCommunityIcons
                name={isSpeakerEnabled ? 'volume-high' : 'volume-off'}
                size={22}
                color={isSpeakerEnabled ? '#a6c455' : '#888'}
              />
              <Text style={styles.controlLabel}>SPEAKER</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.controlButtonSmall}
              onPress={() => {
                switchCamera();
                webrtcService.switchCamera();
              }}
              disabled={!isVideoEnabled}>
              <MaterialCommunityIcons
                name="camera-flip"
                size={22}
                color={isVideoEnabled ? '#a6c455' : '#555'}
              />
              <Text style={styles.controlLabel}>FLIP</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom row: primary actions */}
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[styles.controlButton, isMuted && styles.controlButtonActive]}
              onPress={toggleMute}>
              <MaterialCommunityIcons
                name={isMuted ? 'microphone-off' : 'microphone'}
                size={28}
                color={isMuted ? '#ff4444' : '#a6c455'}
              />
              <Text style={styles.controlLabel}>
                {isMuted ? 'UNMUTE' : 'MUTE'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlButton, styles.endCallButton]}
              onPress={handleEndCall}>
              <MaterialCommunityIcons
                name="phone-hangup"
                size={28}
                color="#fff"
              />
              <Text style={[styles.controlLabel, { color: '#fff' }]}>END</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlButton, !isVideoEnabled && styles.controlButtonActive]}
              onPress={toggleVideo}>
              <MaterialCommunityIcons
                name={isVideoEnabled ? 'video' : 'video-off'}
                size={28}
                color={isVideoEnabled ? '#a6c455' : '#ff4444'}
              />
              <Text style={styles.controlLabel}>
                {isVideoEnabled ? 'HIDE' : 'SHOW'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#171717',
  },
  remoteVideoContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
  },
  avatarContainer: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#2a2a2a',
    borderWidth: 4,
    borderColor: '#4d5d30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  callInfoOverlay: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  displayName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1.5,
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#a6c455',
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    color: '#a6c455',
    letterSpacing: 1,
    fontWeight: '600',
  },
  localVideoContainer: {
    position: 'absolute',
    top: 120,
    right: 16,
    width: 120,
    height: 160,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    overflow: 'hidden',
    zIndex: 10,
    elevation: 10, // For Android shadow and z-index
  },
  localVideo: {
    width: '100%',
    height: '100%',
  },
  localVideoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controls: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
    backgroundColor: '#1a1a1a',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    marginBottom: 12,
  },
  controlButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2a2a2a',
    borderWidth: 2,
    borderColor: '#3a3a3a',
  },
  controlButtonSmall: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  controlButtonActive: {
    backgroundColor: '#3a3a3a',
    borderColor: '#4d5d30',
  },
  endCallButton: {
    backgroundColor: '#ff4444',
    borderColor: '#ff6666',
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  controlLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#888',
    marginTop: 3,
    letterSpacing: 0.5,
  },
});
