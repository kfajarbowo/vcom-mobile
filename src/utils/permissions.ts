import {PermissionsAndroid, Platform, Linking} from 'react-native';
import {openSettings, PERMISSIONS, request, check, RESULTS} from 'react-native-permissions';

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
    // iOS - use react-native-permissions
    try {
      const cameraResult = await request(PERMISSIONS.IOS.CAMERA);
      const micResult = await request(PERMISSIONS.IOS.MICROPHONE);

      console.log('[Permissions] iOS camera result:', cameraResult);
      console.log('[Permissions] iOS microphone result:', micResult);

      return (
        (cameraResult === RESULTS.GRANTED || cameraResult === RESULTS.LIMITED) &&
        (micResult === RESULTS.GRANTED || micResult === RESULTS.LIMITED)
      );
    } catch (err) {
      console.error('[Permissions] Error requesting iOS permissions:', err);
      return false;
    }
  }
}

export async function requestCameraPermission(): Promise<boolean> {
  try {
    console.log('[Permissions] Requesting camera permission...');

    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'VComm needs access to your camera to take photos and videos',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );

      console.log('[Permissions] Camera granted:', granted === PermissionsAndroid.RESULTS.GRANTED);
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } else {
      // iOS - use react-native-permissions
      const result = await request(PERMISSIONS.IOS.CAMERA);
      console.log('[Permissions] iOS camera permission result:', result);
      return result === RESULTS.GRANTED || result === RESULTS.LIMITED;
    }
  } catch (err) {
    console.error('[Permissions] Error requesting camera permission:', err);
    return false;
  }
}

export async function requestCameraAndVideoPermissions(): Promise<boolean> {
  try {
    console.log('[Permissions] Requesting camera and microphone permissions for video...');

    if (Platform.OS === 'android') {
      const cameraGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'VComm needs access to your camera to record videos',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );

      const audioGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'VComm needs access to your microphone to record videos',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );

      const bothGranted =
        cameraGranted === PermissionsAndroid.RESULTS.GRANTED &&
        audioGranted === PermissionsAndroid.RESULTS.GRANTED;

      console.log('[Permissions] Camera granted:', cameraGranted === PermissionsAndroid.RESULTS.GRANTED);
      console.log('[Permissions] Audio granted:', audioGranted === PermissionsAndroid.RESULTS.GRANTED);

      return bothGranted;
    } else {
      // iOS - use react-native-permissions
      const cameraResult = await request(PERMISSIONS.IOS.CAMERA);
      const micResult = await request(PERMISSIONS.IOS.MICROPHONE);

      console.log('[Permissions] iOS camera result:', cameraResult);
      console.log('[Permissions] iOS microphone result:', micResult);

      return (
        (cameraResult === RESULTS.GRANTED || cameraResult === RESULTS.LIMITED) &&
        (micResult === RESULTS.GRANTED || micResult === RESULTS.LIMITED)
      );
    }
  } catch (err) {
    console.error('[Permissions] Error requesting camera/video permissions:', err);
    return false;
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
    // iOS - use react-native-permissions
    try {
      const result = await request(PERMISSIONS.IOS.MICROPHONE);
      console.log('[Permissions] iOS microphone permission result:', result);
      return result === RESULTS.GRANTED || result === RESULTS.LIMITED;
    } catch (err) {
      console.error('[Permissions] Error requesting iOS microphone permission:', err);
      return false;
    }
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
