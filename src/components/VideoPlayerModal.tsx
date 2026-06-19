import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import Video, { VideoRef } from 'react-native-video';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface VideoPlayerModalProps {
  visible: boolean;
  videoUrl: string;
  videoName?: string;
  onClose: () => void;
}

export function VideoPlayerModal({
  visible,
  videoUrl,
  videoName,
  onClose,
}: VideoPlayerModalProps) {
  const videoRef = useRef<VideoRef>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetState = useCallback(() => {
    setPaused(false);
    setMuted(false);
    setLoading(true);
    setError(null);
    setDuration(0);
    setCurrentTime(0);
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
  }, []);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressWidth =
    duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  const handleVideoPress = () => {
    setShowControls(prev => {
      if (!prev) {
        // Show then auto-hide after 3s
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
      }
      return !prev;
    });
  };

  const handlePlayPause = () => {
    setPaused(p => !p);
    // Reset auto-hide timer
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  };

  const handleSeek = (e: any) => {
    const { locationX } = e.nativeEvent;
    const seekRatio = Math.max(0, Math.min(locationX / (SCREEN_WIDTH - 48), 1));
    const seekTime = seekRatio * duration;
    videoRef.current?.seek(seekTime);
    setCurrentTime(seekTime);
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={handleClose}
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.root}>
        <StatusBar hidden />

        {/* Video */}
        {videoUrl ? (
          <TouchableOpacity
            activeOpacity={1}
            style={styles.videoWrapper}
            onPress={handleVideoPress}>
            <Video
              ref={videoRef}
              source={{ uri: videoUrl }}
              style={styles.video}
              resizeMode="contain"
              paused={paused}
              muted={muted}
              repeat={false}
              onLoad={data => {
                setDuration(data.duration);
                setLoading(false);
              }}
              onProgress={data => setCurrentTime(data.currentTime)}
              onEnd={() => setPaused(true)}
              onError={err => {
                console.error('[VideoPlayerModal] Video error:', err);
                setError('Failed to play video. The file may be corrupted or unsupported.');
                setLoading(false);
              }}
            />

            {/* Loading spinner */}
            {loading && !error && (
              <View style={styles.overlay}>
                <ActivityIndicator size="large" color="#a6c455" />
                <Text style={styles.loadingText}>LOADING VIDEO...</Text>
              </View>
            )}

            {/* Error state */}
            {error && (
              <View style={styles.overlay}>
                <MaterialCommunityIcons name="alert-circle" size={64} color="#d97070" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </TouchableOpacity>
        ) : null}

        {/* Controls overlay */}
        {showControls && !loading && !error && (
          <View style={styles.controlsContainer} pointerEvents="box-none">
            {/* Top bar */}
            <View style={styles.topBar}>
              <MaterialCommunityIcons name="video" size={18} color="#a6c455" />
              <Text style={styles.videoTitle} numberOfLines={1}>
                {videoName || 'Video'}
              </Text>
              <TouchableOpacity onPress={handleClose} style={styles.iconBtn}>
                <MaterialCommunityIcons name="close" size={26} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Bottom bar */}
            <View style={styles.bottomBar}>
              {/* Play/Pause */}
              <TouchableOpacity onPress={handlePlayPause} style={styles.iconBtn}>
                <MaterialCommunityIcons
                  name={paused ? 'play-circle' : 'pause-circle'}
                  size={40}
                  color="#a6c455"
                />
              </TouchableOpacity>

              {/* Seek bar */}
              <TouchableOpacity
                activeOpacity={1}
                style={styles.seekBarContainer}
                onPress={handleSeek}>
                <View style={styles.seekBarBg}>
                  <View style={[styles.seekBarFill, { width: `${progressWidth}%` }]} />
                </View>
              </TouchableOpacity>

              {/* Time */}
              <Text style={styles.timeText}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </Text>

              {/* Mute */}
              <TouchableOpacity onPress={() => setMuted(m => !m)} style={styles.iconBtn}>
                <MaterialCommunityIcons
                  name={muted ? 'volume-off' : 'volume-high'}
                  size={22}
                  color="#fff"
                />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Fallback close button when controls hidden */}
        {!showControls && (
          <TouchableOpacity style={styles.hiddenClose} onPress={handleVideoPress} />
        )}

        {/* Close button when loading or error */}
        {(loading || error) && (
          <TouchableOpacity style={styles.loadingClose} onPress={handleClose}>
            <MaterialCommunityIcons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    gap: 12,
  },
  loadingText: {
    color: '#a6c455',
    fontSize: 12,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  errorText: {
    color: '#d97070',
    fontSize: 13,
    letterSpacing: 0.5,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 32,
    marginTop: 8,
  },
  controlsContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: StatusBar.currentHeight ? StatusBar.currentHeight + 8 : 16,
    paddingBottom: 12,
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  videoTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 24,
    paddingTop: 12,
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  iconBtn: {
    padding: 4,
  },
  seekBarContainer: {
    flex: 1,
    paddingVertical: 10,
  },
  seekBarBg: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  seekBarFill: {
    height: '100%',
    backgroundColor: '#a6c455',
    borderRadius: 2,
  },
  timeText: {
    color: '#ccc',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    minWidth: 80,
    textAlign: 'right',
  },
  hiddenClose: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingClose: {
    position: 'absolute',
    top: StatusBar.currentHeight ? StatusBar.currentHeight + 8 : 16,
    right: 16,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
});
