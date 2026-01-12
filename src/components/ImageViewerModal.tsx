import React, {useState} from 'react';
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
import ImageViewer from 'react-native-image-zoom-viewer';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

interface ImageViewerModalProps {
  visible: boolean;
  imageUrl: string;
  imageName?: string;
  onClose: () => void;
}

export function ImageViewerModal({
  visible,
  imageUrl,
  imageName,
  onClose,
}: ImageViewerModalProps) {
  const [loading, setLoading] = useState(true);

  const images = [
    {
      url: imageUrl,
      props: {},
    },
  ];

  const handleClose = () => {
    setLoading(true);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={handleClose}
      statusBarTranslucent>
      <StatusBar hidden />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <MaterialCommunityIcons name="image" size={20} color="#a6c455" />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {imageName || 'Image'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            activeOpacity={0.7}>
            <MaterialCommunityIcons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Image Viewer */}
        <View style={styles.imageContainer}>
          <ImageViewer
            imageUrls={images}
            enableSwipeDown={true}
            onSwipeDown={handleClose}
            backgroundColor="#000000"
            renderIndicator={() => null}
            loadingRender={() => (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#a6c455" />
                <Text style={styles.loadingText}>LOADING IMAGE...</Text>
              </View>
            )}
            onLoadEnd={() => setLoading(false)}
            enableImageZoom={true}
            saveToLocalByLongPress={false}
            doubleClickInterval={300}
            renderHeader={() => <View style={{height: 60}} />}
          />
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(26, 26, 26, 0.95)',
    borderBottomWidth: 2,
    borderBottomColor: '#4d5d30',
    zIndex: 10,
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
  imageContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
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
});
