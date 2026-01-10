import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import {WebView} from 'react-native-webview';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
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
  const [sessionToken, setSessionToken] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      // Load session token when modal opens
      getSessionToken()
        .then(token => {
          console.log('[VideoPlayerModal] Session token loaded:', !!token);
          setSessionToken(token || '');
        })
        .catch(err => {
          console.error('[VideoPlayerModal] Failed to get session token:', err);
          setError('Failed to load session');
        });
    }
  }, [visible]);

  const handleClose = () => {
    setLoading(true);
    setError(null);
    onClose();
  };

  // Create HTML that uses the video URL directly
  const videoHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
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
        #loading {
          position: absolute;
          color: #a6c455;
          font-family: monospace;
          font-size: 14px;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div id="loading">Loading video...</div>
      <video
        id="video"
        controls
        playsinline
        preload="auto"
        src="${videoUrl}"
        style="display:none;"
        onloadedmetadata="document.getElementById('loading').style.display='none';this.style.display='block';window.ReactNativeWebView.postMessage('loaded');"
        onerror="document.getElementById('loading').textContent='Failed to load video';window.ReactNativeWebView.postMessage('error');"
      ></video>
    </body>
    </html>
  `;

  // WebView source with custom headers
  const webViewSource = {
    html: videoHTML,
    baseUrl: videoUrl.substring(0, videoUrl.lastIndexOf('/'))
  };

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
              <Text style={styles.errorHint}>
                The video requires authentication. Try playing it from a browser or downloading it.
              </Text>
              <TouchableOpacity
                style={styles.closeButtonBottom}
                onPress={handleClose}>
                <Text style={styles.closeButtonText}>CLOSE</Text>
              </TouchableOpacity>
            </View>
          ) : sessionToken ? (
            <WebView
              source={webViewSource}
              style={styles.webview}
              allowsFullscreenVideo={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              mixedContentMode="always"
              sharedCookiesEnabled={true}
              thirdPartyCookiesEnabled={true}
              onMessage={(event) => {
                const message = event.nativeEvent.data;
                console.log('[VideoPlayerModal] Message:', message);
                if (message === 'loaded') {
                  setLoading(false);
                } else if (message === 'error') {
                  setError('Video playback failed. The video may require authentication that WebView cannot provide.');
                  setLoading(false);
                }
              }}
              onError={(syntheticEvent) => {
                const { nativeEvent } = syntheticEvent;
                console.error('[VideoPlayerModal] WebView error:', nativeEvent);
                setError('WebView failed to load');
                setLoading(false);
              }}
              onLoadEnd={() => {
                console.log('[VideoPlayerModal] WebView load end');
              }}
            />
          ) : (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#a6c455" />
              <Text style={styles.loadingText}>INITIALIZING...</Text>
            </View>
          )}
          {loading && !error && sessionToken && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#a6c455" />
              <Text style={styles.loadingText}>LOADING VIDEO...</Text>
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
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
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
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: 0.5,
    fontWeight: 'bold',
  },
  errorHint: {
    color: '#999',
    fontSize: 12,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 18,
  },
  closeButtonBottom: {
    backgroundColor: '#4d5d30',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#5a6b38',
  },
  closeButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
