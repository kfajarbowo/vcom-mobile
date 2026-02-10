import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {WebView} from 'react-native-webview';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFetchBlob from 'rn-fetch-blob';
import {getSessionToken} from '../services/apiClient';

interface VideoPlayerModalProps {
  visible: boolean;
  videoUrl: string;
  videoName?: string;
  onClose: () => void;
}

const {width: screenWidth, height: screenHeight} = Dimensions.get('window');

export function VideoPlayerModal({
  visible,
  videoUrl,
  videoName,
  onClose,
}: VideoPlayerModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localFilePath, setLocalFilePath] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const tempFileRef = useRef<string | null>(null);

  useEffect(() => {
    if (visible && videoUrl) {
      downloadVideo();
    }

    return () => {
      // Clean up temp file on unmount or when modal closes
      cleanupTempFile();
    };
  }, [visible, videoUrl]);

  const cleanupTempFile = () => {
    if (tempFileRef.current) {
      RNFetchBlob.fs
        .unlink(tempFileRef.current)
        .catch(() => {}); // Ignore cleanup errors
      tempFileRef.current = null;
    }
  };

  const downloadVideo = async () => {
    try {
      setLoading(true);
      setError(null);
      setDownloadProgress(0);
      setLocalFilePath(null);

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

      // Convert to file URI for WebView
      const fileUri =
        Platform.OS === 'android'
          ? `file://${filePath}`
          : filePath;

      setLocalFilePath(fileUri);
      setLoading(false);
    } catch (err: any) {
      console.error('[VideoPlayerModal] Download error:', err);
      setError(`Failed to download video: ${err.message || 'Unknown error'}`);
      setLoading(false);
    }
  };

  const handleClose = () => {
    setLoading(true);
    setError(null);
    setLocalFilePath(null);
    cleanupTempFile();
    onClose();
  };

  // Create HTML that plays from local file
  const videoHTML = localFilePath
    ? `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background-color: #000000;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          overflow: hidden;
        }
        video {
          width: 100%;
          height: 100%;
          max-width: 100vw;
          max-height: 100vh;
          object-fit: contain;
        }
      </style>
    </head>
    <body>
      <video
        controls
        playsinline
        autoplay
        preload="auto"
        src="${localFilePath}"
      ></video>
    </body>
    </html>
  `
    : '';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={handleClose}
      statusBarTranslucent>
      <StatusBar hidden />
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

        {/* Video Player */}
        <View style={styles.videoContainer}>
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
                onPress={downloadVideo}>
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
          ) : localFilePath ? (
            <WebView
              source={{html: videoHTML, baseUrl: ''}}
              style={styles.webview}
              allowsFullscreenVideo={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              allowFileAccess={true}
              allowFileAccessFromFileURLs={true}
              allowUniversalAccessFromFileURLs={true}
              originWhitelist={['*']}
              onError={(syntheticEvent) => {
                const {nativeEvent} = syntheticEvent;
                console.error('[VideoPlayerModal] WebView error:', nativeEvent);
                setError('Video playback failed');
              }}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  videoContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  loadingText: {
    color: '#a6c455',
    fontSize: 12,
    marginTop: 12,
    letterSpacing: 1,
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
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
  },
  closeButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
