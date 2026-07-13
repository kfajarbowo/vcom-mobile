import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
  Alert,
  PermissionsAndroid,
} from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import RNFetchBlob from 'rn-fetch-blob';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

type RecorderState = 'idle' | 'recording' | 'preview';

interface VoiceNoteRecorderProps {
  onSend: (fileUri: string, duration: number) => void;
  onCancel: () => void;
}

const audioRecorderPlayer = new AudioRecorderPlayer();

export function VoiceNoteRecorder({ onSend, onCancel }: VoiceNoteRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle');
  const [recordTime, setRecordTime] = useState('00:00');
  const [recordDurationMs, setRecordDurationMs] = useState(0);
  const [playTime, setPlayTime] = useState('00:00');
  const [playDuration, setPlayDuration] = useState('00:00');
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      audioRecorderPlayer.stopRecorder().catch(() => { });
      audioRecorderPlayer.stopPlayer().catch(() => { });
      audioRecorderPlayer.removeRecordBackListener();
      audioRecorderPlayer.removePlayBackListener();
    };
  }, []);

  useEffect(() => {
    if (state === 'recording') {
      pulseRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulseRef.current.start();
    } else {
      pulseRef.current?.stop();
      pulseAnim.setValue(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const requestRecordingPermissions = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const audioGranted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'VComm needs access to your microphone to record voice notes.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );

        if (audioGranted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Permission Required', 'Microphone permission is needed to record voice notes.');
          return false;
        }

        // On Android < 13 (API 33), also need WRITE_EXTERNAL_STORAGE
        const apiLevel = Number(Platform.Version);
        if (apiLevel < 33) {
          const storageGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
            {
              title: 'Storage Permission',
              message: 'VComm needs storage access to save voice notes.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            },
          );
          if (storageGranted !== PermissionsAndroid.RESULTS.GRANTED) {
            Alert.alert('Permission Required', 'Storage permission is needed to save voice notes.');
            return false;
          }
        }

        return true;
      } catch (err) {
        console.error('[VoiceRecorder] Permission error:', err);
        return false;
      }
    }
    // iOS permissions handled by the framework
    return true;
  };

  const startRecording = async () => {
    const hasPermission = await requestRecordingPermissions();
    if (!hasPermission) {return;}

    try {
      // Always stop any previous recorder session first to prevent
      // "startRecorder has already been called" error.
      // This is needed because audioRecorderPlayer is a module-level singleton
      // and may still be in a recording state from a previous component mount.
      try {
        await audioRecorderPlayer.stopRecorder();
      } catch (_) {
        // Ignore - recorder may not have been active
      }
      audioRecorderPlayer.removeRecordBackListener();

      // Use app cache directory to avoid needing broad storage permissions
      const fileName = `voice_${Date.now()}.m4a`;
      const path = Platform.select({
        android: `${RNFetchBlob.fs.dirs.CacheDir}/${fileName}`,
        ios: fileName,
      });

      const uri = await audioRecorderPlayer.startRecorder(path);
      audioRecorderPlayer.addRecordBackListener((e) => {
        setRecordTime(audioRecorderPlayer.mmssss(Math.floor(e.currentPosition)).slice(0, 5));
        setRecordDurationMs(e.currentPosition);
      });
      setRecordedUri(uri);
      setState('recording');
    } catch (error) {
      console.error('[VoiceRecorder] Error starting recording:', error);
      Alert.alert('Recording Error', 'Failed to start recording. Please check app permissions.');
    }
  };

  const stopRecording = async () => {
    try {
      await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();
      setState('preview');
    } catch (error) {
      console.error('[VoiceRecorder] Error stopping recording:', error);
    }
  };

  const playRecording = async () => {
    if (!recordedUri) {return;}
    try {
      await audioRecorderPlayer.startPlayer(recordedUri);
      audioRecorderPlayer.addPlayBackListener((e) => {
        setPlayTime(audioRecorderPlayer.mmssss(Math.floor(e.currentPosition)).slice(0, 5));
        setPlayDuration(audioRecorderPlayer.mmssss(Math.floor(e.duration)).slice(0, 5));
        if (e.currentPosition >= e.duration) {
          stopPlayback();
        }
      });
      setIsPlaying(true);
    } catch (error) {
      console.error('[VoiceRecorder] Error playing recording:', error);
    }
  };

  const stopPlayback = async () => {
    try {
      await audioRecorderPlayer.stopPlayer();
      audioRecorderPlayer.removePlayBackListener();
      setIsPlaying(false);
      setPlayTime('00:00');
    } catch (error) {
      console.error('[VoiceRecorder] Error stopping playback:', error);
    }
  };

  const handleCancel = async () => {
    await audioRecorderPlayer.stopRecorder().catch(() => { });
    await audioRecorderPlayer.stopPlayer().catch(() => { });
    audioRecorderPlayer.removeRecordBackListener();
    audioRecorderPlayer.removePlayBackListener();
    setState('idle');
    setRecordedUri(null);
    setRecordTime('00:00');
    onCancel();
  };

  const handleSend = () => {
    if (recordedUri) {
      onSend(recordedUri, Math.floor(recordDurationMs / 1000));
      setState('idle');
      setRecordedUri(null);
      setRecordTime('00:00');
    }
  };

  if (state === 'idle') {
    return (
      <TouchableOpacity onPress={startRecording} style={styles.micButton}>
        <MaterialCommunityIcons name="microphone" size={22} color="#a6c455" />
      </TouchableOpacity>
    );
  }

  if (state === 'recording') {
    return (
      <View style={styles.recordingContainer}>
        <TouchableOpacity onPress={handleCancel} style={styles.cancelButton}>
          <MaterialCommunityIcons name="delete" size={20} color="#ff4444" />
        </TouchableOpacity>

        <Animated.View style={[styles.recordingIndicator, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.recordDot} />
        </Animated.View>

        <Text style={styles.timerText}>{recordTime}</Text>

        <TouchableOpacity onPress={stopRecording} style={styles.stopButton}>
          <MaterialCommunityIcons name="stop" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  // Preview state
  return (
    <View style={styles.previewContainer}>
      <TouchableOpacity onPress={handleCancel} style={styles.cancelButton}>
        <MaterialCommunityIcons name="delete" size={20} color="#ff4444" />
      </TouchableOpacity>

      <TouchableOpacity onPress={isPlaying ? stopPlayback : playRecording} style={styles.playButton}>
        <MaterialCommunityIcons
          name={isPlaying ? 'pause' : 'play'}
          size={20}
          color="#a6c455"
        />
      </TouchableOpacity>

      <Text style={styles.timerText}>
        {isPlaying ? `${playTime} / ${playDuration}` : recordTime}
      </Text>

      <TouchableOpacity onPress={handleSend} style={styles.sendVoiceButton}>
        <MaterialCommunityIcons name="send" size={22} color="#a6c455" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  micButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 8,
    gap: 10,
  },
  previewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 8,
    gap: 10,
  },
  cancelButton: {
    padding: 6,
  },
  recordingIndicator: {
    width: 12,
    height: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff4444',
  },
  timerText: {
    color: '#ccc',
    fontFamily: 'monospace',
    fontSize: 14,
    flex: 1,
  },
  stopButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ff4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    padding: 6,
  },
  sendVoiceButton: {
    padding: 6,
  },
});
