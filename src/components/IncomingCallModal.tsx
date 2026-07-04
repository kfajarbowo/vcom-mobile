import React, { useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { Participant, useCallStore } from '../store/callStore';
import { webrtcService } from '../services/webrtcService';
import { callNotificationService } from '../services/callNotificationService';

export function IncomingCallModal() {
  const { status, callerName, callType, callId, offer, isGroupCall, groupName, getAllParticipants } = useCallStore();

  const isVisible = status === 'ringing';
  const participants = getAllParticipants();

  // For 1-on-1 calls, we need the offer to accept
  const canAccept = isGroupCall || !!offer;

  // Report call ended to CallKit when call ends (iOS)
  useEffect(() => {
    if (status === 'ended' || status === 'idle') {
      callNotificationService.reportCallEnded();
      callNotificationService.cancelCallNotification(); // Explicitly cancel on end
    } else if (status === 'active' || status === 'calling') {
      if (status === 'active') {
        callNotificationService.reportCallConnected();
      }
      callNotificationService.cancelCallNotification(); // Cancel once connected or answering
    }
  }, [status]);

  const handleAccept = async () => {
    try {
      // Cancel notification IMMEDIATELY before any state changes
      // (state changes cause this component to unmount, preventing useEffect cleanup)
      console.log('[IncomingCall] Canceling notification on accept');
      callNotificationService.cancelCallNotification();

      // Get fresh state from store to ensure we have the latest values
      const currentState = useCallStore.getState();
      const currentOffer = currentState.offer;
      const currentCallType = currentState.callType;
      const currentIsGroupCall = currentState.isGroupCall;

      console.log('[IncomingCall] Accepting call, isGroupCall:', currentIsGroupCall);
      console.log('[IncomingCall] Has offer:', !!currentOffer);

      if (currentIsGroupCall) {
        // For group calls, just join the call
        console.log('[IncomingCall] Accepting group call');
        useCallStore.getState().setCallStatus('calling');

        // Get participant IDs from current state
        const currentParticipants = currentState.getAllParticipants();
        const participantIds = currentParticipants.map((p: Participant) => p.userId);

        // Start group call
        await webrtcService.startGroupCall(participantIds);
      } else {
        // For 1-on-1 calls, answer with the offer
        if (!currentOffer) {
          console.error('[IncomingCall] No offer available to answer - waiting for offer to arrive');
          // Don't end the call, just return and wait for offer
          return;
        }

        useCallStore.getState().setCallStatus('calling');

        // Answer the call with the stored offer
        await webrtcService.answerCall(currentCallType, currentOffer);
      }
    } catch (error) {
      console.error('[IncomingCall] Error accepting call:', error);
      const currentState = useCallStore.getState();
      if (currentState.isGroupCall) {
        webrtcService.endGroupCall();
      } else {
        webrtcService.endCall();
      }
    }
  };

  const handleReject = () => {
    console.log('[IncomingCall] Rejecting call');
    // Cancel notification IMMEDIATELY before any state changes
    // (state changes cause this component to unmount, preventing useEffect cleanup)
    console.log('[IncomingCall] Canceling notification on reject');
    callNotificationService.cancelCallNotification();

    // Get fresh state from store
    const currentState = useCallStore.getState();
    if (currentState.isGroupCall) {
      webrtcService.endGroupCall();
    } else {
      webrtcService.rejectCall();
    }
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
                name={isGroupCall ? 'account-group' : 'account'}
                size={60}
                color="#a6c455"
              />
            </View>
            <Text style={styles.callerName}>
              {isGroupCall ? (groupName || 'Group Call') : (callerName || 'Unknown')}
            </Text>
            <Text style={styles.callType}>
              {isGroupCall
                ? `GROUP ${callType === 'video' ? 'VIDEO' : 'VOICE'} CALL`
                : callType === 'video' ? 'VIDEO CALL' : 'VOICE CALL'}
            </Text>
            {isGroupCall && participants.length > 0 && (
              <Text style={styles.participantCount}>
                {participants.length + 1} PARTICIPANTS
              </Text>
            )}
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
              style={[
                styles.actionButton,
                styles.acceptButton,
                !canAccept && styles.disabledButton,
              ]}
              onPress={handleAccept}
              disabled={!canAccept}>
              <MaterialCommunityIcons
                name="phone"
                size={32}
                color="#fff"
              />
              <Text style={styles.actionLabel}>
                {canAccept ? 'ACCEPT' : 'WAIT...'}
              </Text>
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
    marginBottom: 8,
  },
  participantCount: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
    letterSpacing: 1,
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
  disabledButton: {
    backgroundColor: '#555',
    borderColor: '#666',
    opacity: 0.7,
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 4,
    letterSpacing: 0.5,
  },
});
