import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Dimensions } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { Participant, useCallStore } from '../store/callStore';
import { webrtcService } from '../services/webrtcService';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export function GroupCallScreen() {
  const {
    status,
    groupName,
    localStream,
    isMuted,
    isVideoEnabled,
    isSpeakerEnabled,
    isFrontCamera,
    isGroupCall,
    toggleMute,
    toggleVideo,
    toggleSpeaker,
    switchCamera,
    participants: participantsMap,
  } = useCallStore();

  const [callDuration, setCallDuration] = useState(0);

  // Convert Map to array for rendering - this now properly subscribes to participantsMap changes
  const participants = useMemo(() => {
    return Array.from(participantsMap.values());
  }, [participantsMap]);

  const isVisible = (status === 'calling' || status === 'active') && isGroupCall;

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
    webrtcService.endGroupCall();
  };

  const getStatusText = () => {
    switch (status) {
      case 'calling':
        return 'CONNECTING...';
      case 'ringing':
        return 'RINGING...';
      case 'active':
        return `${formatDuration(callDuration)}`;
      default:
        return 'ESTABLISHING CONNECTION...';
    }
  };

  const renderParticipantTile = (participant: any, index: number) => {
    const participantCount = participants.length;
    const tilesPerRow = participantCount <= 2 ? 1 : 2;
    const tileWidth = SCREEN_WIDTH / tilesPerRow - 16;
    const tileHeight = participantCount === 1 ? SCREEN_HEIGHT * 0.5 : SCREEN_HEIGHT / 3;

    // Check if participant has video enabled and has a stream with video tracks
    const hasVideoStream = participant.stream && participant.stream.getVideoTracks().length > 0;
    const isParticipantVideoEnabled = participant.isVideoEnabled !== false && hasVideoStream;

    return (
      <View
        key={participant.userId}
        style={[
          styles.participantTile,
          {
            width: tileWidth,
            height: tileHeight,
          },
        ]}>
        {isParticipantVideoEnabled ? (
          <RTCView
            key={`rtcview-${participant.userId}-${participant.stream?.id || 'no-stream'}`}
            streamURL={participant.stream.toURL()}
            style={styles.participantVideo}
            objectFit="cover"
            mirror={false}
          />
        ) : (
          <View style={styles.participantAvatar}>
            <MaterialCommunityIcons name="account" size={60} color="#a6c455" />
            {!isParticipantVideoEnabled && (
              <View style={styles.cameraOffBadge}>
                <MaterialCommunityIcons name="video-off" size={20} color="#ff4444" />
              </View>
            )}
          </View>
        )}

        {/* Participant Info Overlay */}
        <View style={styles.participantInfo}>
          <Text style={styles.participantName}>{participant.userName}</Text>
          {!isParticipantVideoEnabled && (
            <MaterialCommunityIcons
              name="video-off"
              size={16}
              color="#ff4444"
              style={styles.statusIcon}
            />
          )}
          {participant.isMuted && (
            <MaterialCommunityIcons
              name="microphone-off"
              size={16}
              color="#ff4444"
              style={styles.statusIcon}
            />
          )}
        </View>
      </View>
    );
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
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.groupName}>
            {groupName?.toUpperCase() || 'GROUP CALL'}
          </Text>
          <Text style={styles.statusText}>
            {getStatusText()} • {participants.length + 1} PARTICIPANTS
          </Text>
        </View>

        {/* Participants Grid */}
        <ScrollView
          style={styles.participantsContainer}
          contentContainerStyle={styles.participantsGrid}>
          {participants.map((participant: Participant, index: any) =>
            renderParticipantTile(participant, index)
          )}
        </ScrollView>

        {/* Local Video PiP — always shown, camera starts off */}
        <View style={styles.localVideoContainer} pointerEvents="box-none">
          {isVideoEnabled && localStream ? (
            <RTCView
              streamURL={localStream.toURL()}
              style={styles.localVideo}
              objectFit="cover"
              mirror={isFrontCamera}
              zOrder={1}
            />
          ) : (
            <View style={styles.localVideoDisabled}>
              <MaterialCommunityIcons name="account" size={40} color="#a6c455" />
              <MaterialCommunityIcons
                name="video-off"
                size={16}
                color="#ff4444"
                style={styles.localCameraOffIcon}
              />
            </View>
          )}
          <Text style={styles.localLabel}>YOU</Text>
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
  header: {
    backgroundColor: '#2a2a2a',
    borderBottomWidth: 1,
    borderBottomColor: '#444444',
    padding: 16,
    alignItems: 'center',
  },
  groupName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  statusText: {
    fontSize: 12,
    color: '#a6c455',
    fontWeight: 'medium',
    letterSpacing: 1,
  },
  participantsContainer: {
    flex: 1,
  },
  participantsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    gap: 8,
  },
  participantTile: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    overflow: 'hidden',
    margin: 4,
    position: 'relative',
  },
  participantVideo: {
    width: '100%',
    height: '100%',
  },
  participantAvatar: {
    width: '100%',
    height: '100%',
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraOffBadge: {
    position: 'absolute',
    bottom: 50,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 12,
    padding: 4,
  },
  participantInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  participantName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 0.5,
    flex: 1,
  },
  statusIcon: {
    marginLeft: 4,
  },
  localVideoContainer: {
    position: 'absolute',
    top: 80,
    right: 16,
    width: 100,
    height: 140,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#a6c455',
    overflow: 'hidden',
    backgroundColor: '#2a2a2a',
    zIndex: 10,
    elevation: 10,
  },
  localVideo: {
    width: '100%',
    height: '100%',
  },
  localVideoDisabled: {
    width: '100%',
    height: '100%',
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  localCameraOffIcon: {
    position: 'absolute',
    bottom: 30,
  },
  localLabel: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    color: '#a6c455',
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingVertical: 2,
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
