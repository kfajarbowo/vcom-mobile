import {PermissionsAndroid, Platform, Linking} from 'react-native';
import {openSettings} from 'react-native-permissions';

export async function requestCameraAndMicrophonePermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    try {
      console.log('[Permissions] Requesting camera and microphone permissions...');

      // Request camera permission
      const cameraGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'VComm needs access to your camera for video calls',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );

      // Request microphone permission
      const audioGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'VComm needs access to your microphone for calls',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );

      console.log('[Permissions] Camera granted:', cameraGranted === PermissionsAndroid.RESULTS.GRANTED);
      console.log('[Permissions] Audio granted:', audioGranted === PermissionsAndroid.RESULTS.GRANTED);

      const bothGranted =
        cameraGranted === PermissionsAndroid.RESULTS.GRANTED &&
        audioGranted === PermissionsAndroid.RESULTS.GRANTED;

      if (bothGranted) {
        console.log('[Permissions] Camera and microphone permissions granted');
        return true;
      } else {
        console.warn('[Permissions] Camera or microphone permissions denied');
        return false;
      }
    } catch (err) {
      console.error('[Permissions] Error requesting permissions:', err);
      return false;
    }
  } else {
    // iOS permissions are handled automatically
    return true;
  }
}

export async function requestMicrophonePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'This app needs access to your microphone for voice calls',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );

      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        console.log('[Permissions] Microphone permission granted');
        return true;
      } else {
        console.warn('[Permissions] Microphone permission denied');
        return false;
      }
    } catch (err) {
      console.error('[Permissions] Error requesting microphone permission:', err);
      return false;
    }
  } else {
    return true;
  }
}

export async function openPermissionSettings(): Promise<void> {
  try {
    console.log('[Permissions] Opening app permission settings');
    await openSettings();
  } catch (error) {
    console.error('[Permissions] Error opening settings:', error);
    // Fallback to native settings
    Linking.openSettings();
  }
}
