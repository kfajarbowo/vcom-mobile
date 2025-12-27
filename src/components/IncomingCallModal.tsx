import React from 'react';
import {View, Text, Modal, TouchableOpacity, StyleSheet} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useCallStore} from '../store/callStore';
import {webrtcService} from '../services/webrtcService';

export function IncomingCallModal() {
  const {status, callerName, callType, callId, offer} = useCallStore();

  const isVisible = status === 'ringing';

  const handleAccept = async () => {
    try {
      console.log('[IncomingCall] Accepting call');

      if (!offer) {
        console.error('[IncomingCall] No offer available to answer');
        webrtcService.endCall();
        return;
      }

      useCallStore.getState().setCallStatus('calling');

      // Answer the call with the stored offer
      await webrtcService.answerCall(callType, offer);
    } catch (error) {
      console.error('[IncomingCall] Error accepting call:', error);
      webrtcService.endCall();
    }
  };

  const handleReject = () => {
    console.log('[IncomingCall] Rejecting call');
    webrtcService.endCall();
  };

  if (!isVisible || !callId) {
    return null;
  }

  return (
    <Modal
      visible={isVisible}
      transparent={true}
      animationType="fade"
      onRequestClose={handleReject}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Caller Info */}
          <View style={styles.callerInfo}>
            <View style={styles.avatarContainer}>
              <MaterialCommunityIcons
                name="account"
                size={60}
                color="#a6c455"
              />
            </View>
            <Text style={styles.callerName}>{callerName || 'Unknown'}</Text>
            <Text style={styles.callType}>
              {callType === 'video' ? 'VIDEO CALL' : 'VOICE CALL'}
            </Text>
            <View style={styles.statusIndicator}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>INCOMING CALL...</Text>
            </View>
          </View>

          {/* Call Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.rejectButton]}
              onPress={handleReject}>
              <MaterialCommunityIcons
                name="phone-hangup"
                size={32}
                color="#fff"
              />
              <Text style={styles.actionLabel}>REJECT</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.acceptButton]}
              onPress={handleAccept}>
              <MaterialCommunityIcons
                name="phone"
                size={32}
                color="#fff"
              />
              <Text style={styles.actionLabel}>ACCEPT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '90%',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    padding: 32,
    alignItems: 'center',
  },
  callerInfo: {
    alignItems: 'center',
    marginBottom: 48,
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#2a2a2a',
    borderWidth: 3,
    borderColor: '#4d5d30',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  callerName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    letterSpacing: 1,
  },
  callType: {
    fontSize: 14,
    color: '#a6c455',
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#a6c455',
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    color: '#888',
    letterSpacing: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: 32,
  },
  actionButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  rejectButton: {
    backgroundColor: '#ff4444',
    borderColor: '#ff6666',
  },
  acceptButton: {
    backgroundColor: '#4d5d30',
    borderColor: '#5a6b38',
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 4,
    letterSpacing: 0.5,
  },
});
