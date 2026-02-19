import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Platform,
  NativeModules,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFetchBlob from 'rn-fetch-blob';
import { getSessionToken } from '../services/apiClient';

const { FileOpener } = NativeModules;

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const tempFileRef = useRef<string | null>(null);

  useEffect(() => {
    if (visible && videoUrl) {
      downloadAndPlayVideo();
    }

    return () => {
      cleanupTempFile();
    };
  }, [visible, videoUrl]);

  const cleanupTempFile = () => {
    if (tempFileRef.current) {
      RNFetchBlob.fs
        .unlink(tempFileRef.current)
        .catch(() => { }); // Ignore cleanup errors
      tempFileRef.current = null;
    }
  };

  const downloadAndPlayVideo = async () => {
    try {
      setLoading(true);
      setError(null);
      setDownloadProgress(0);

      const sessionToken = await getSessionToken();
      if (!sessionToken) {
        setError('No session token available');
        setLoading(false);
        return;
      }

      console.log('[VideoPlayerModal] Downloading video with auth:', videoUrl);

      // Determine file extension from URL
      const urlPath = videoUrl.split('?')[0];
      const ext = urlPath.split('.').pop()?.toLowerCase() || 'mp4';

      const res = await RNFetchBlob.config({
        fileCache: true,
        appendExt: ext,
      })
        .fetch('GET', videoUrl, {
          'X-Session-Token': sessionToken,
        })
        .progress((received, total) => {
          if (total > 0) {
            setDownloadProgress(Math.round((received / total) * 100));
          }
        });

      const filePath = res.path();
      console.log('[VideoPlayerModal] Video downloaded to:', filePath);

      tempFileRef.current = filePath;
      setLoading(false);

      // Open with native system video player
      await openWithNativePlayer(filePath);
    } catch (err: any) {
      console.error('[VideoPlayerModal] Download error:', err);
      setError(`Failed to download video: ${err.message || 'Unknown error'}`);
      setLoading(false);
    }
  };

  const openWithNativePlayer = async (filePath: string) => {
    try {
      // Determine MIME type from extension
      const ext = filePath.split('.').pop()?.toLowerCase() || 'mp4';
      const mimeTypes: Record<string, string> = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        mpeg: 'video/mpeg',
        ogg: 'video/ogg',
        avi: 'video/x-msvideo',
        mkv: 'video/x-matroska',
        '3gp': 'video/3gpp',
        mov: 'video/quicktime',
      };
      const mimeType = mimeTypes[ext] || 'video/*';

      console.log('[VideoPlayerModal] Opening with native player:', filePath, mimeType);

      if (Platform.OS === 'android') {
        try {
          // Use our custom FileOpener module with FileProvider support
          await FileOpener.openFile(filePath, mimeType);
          console.log('[VideoPlayerModal] FileOpener succeeded');
        } catch (openerError: any) {
          console.error('[VideoPlayerModal] FileOpener failed:', openerError);

          // Fallback: Try RNFetchBlob's actionViewIntent
          try {
            await RNFetchBlob.android.actionViewIntent(filePath, mimeType);
            console.log('[VideoPlayerModal] actionViewIntent succeeded');
          } catch (intentError: any) {
            console.error('[VideoPlayerModal] actionViewIntent failed:', intentError);
            setError('No video player app found. Please install a video player.');
          }
        }
      } else {
        // iOS
        try {
          await RNFetchBlob.ios.openDocument(filePath);
        } catch (iosError: any) {
          console.error('[VideoPlayerModal] iOS openDocument failed:', iosError);
          setError('Failed to open video player.');
        }
      }
    } catch (err: any) {
      console.error('[VideoPlayerModal] Error opening native player:', err);
      setError('Failed to open video. Please try again.');
    }
  };

  const handleClose = () => {
    setLoading(true);
    setError(null);
    cleanupTempFile();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={handleClose}
      statusBarTranslucent>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <MaterialCommunityIcons name="video" size={20} color="#a6c455" />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {videoName || 'Video'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            activeOpacity={0.7}>
            <MaterialCommunityIcons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.contentContainer}>
          {error ? (
            <View style={styles.errorContainer}>
              <MaterialCommunityIcons
                name="alert-circle"
                size={64}
                color="#d97070"
              />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={downloadAndPlayVideo}>
                <Text style={styles.retryButtonText}>RETRY</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.closeButtonBottom}
                onPress={handleClose}>
                <Text style={styles.closeButtonText}>CLOSE</Text>
              </TouchableOpacity>
            </View>
          ) : loading ? (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#a6c455" />
              <Text style={styles.loadingText}>
                {downloadProgress > 0
                  ? `DOWNLOADING... ${downloadProgress}%`
                  : 'PREPARING VIDEO...'}
              </Text>
            </View>
          ) : (
            <View style={styles.readyContainer}>
              <MaterialCommunityIcons
                name="play-circle"
                size={80}
                color="#a6c455"
              />
              <Text style={styles.readyText}>VIDEO READY</Text>
              <Text style={styles.readySubtext}>
                Opened in your device's video player
              </Text>
              <TouchableOpacity
                style={styles.playAgainButton}
                onPress={() => tempFileRef.current && openWithNativePlayer(tempFileRef.current)}>
                <MaterialCommunityIcons name="play" size={20} color="#ffffff" />
                <Text style={styles.playAgainText}>PLAY AGAIN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.closeButtonBottom}
                onPress={handleClose}>
                <Text style={styles.closeButtonText}>CLOSE</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: StatusBar.currentHeight ? StatusBar.currentHeight + 12 : 12,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 2,
    borderBottomColor: '#4d5d30',
  },
  headerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    flex: 1,
  },
  closeButton: {
    padding: 4,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingOverlay: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#a6c455',
    fontSize: 12,
    marginTop: 12,
    letterSpacing: 1,
    fontWeight: '600',
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    color: '#d97070',
    fontSize: 14,
    marginTop: 16,
    marginBottom: 24,
    textAlign: 'center',
    letterSpacing: 0.5,
    fontWeight: 'bold',
  },
  retryButton: {
    backgroundColor: '#4d5d30',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#5a6b38',
    marginBottom: 12,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  closeButtonBottom: {
    backgroundColor: '#333',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#555',
    marginTop: 8,
  },
  closeButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  readyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  readyText: {
    color: '#a6c455',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginTop: 16,
  },
  readySubtext: {
    color: '#888',
    fontSize: 12,
    marginTop: 8,
    letterSpacing: 0.5,
  },
  playAgainButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4d5d30',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#5a6b38',
    marginTop: 24,
    gap: 8,
  },
  playAgainText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
