/**
 * Device Information Utility
 * Provides device-specific information for license binding
 *
 * Uses Android ID for hardware binding (unique per device).
 *
 * @module utils/deviceInfo
 */

import { Platform } from 'react-native';

/**
 * Get device Android ID or unique hardware ID
 *
 * For Android: Uses Android ID (unique, persistent device identifier)
 * For iOS: Uses unique device identifier
 *
 * Requires: npm install react-native-device-info
 *
 * @returns Promise<string> Device Android ID or unique identifier (minimum 8 chars)
 */
export async function getDeviceHardwareId(): Promise<string> {
  try {
    // Try to use react-native-device-info if available
    try {
      const DeviceInfo = require('react-native-device-info');

      if (Platform.OS === 'android') {
        // For Android: Get Android ID (no permission required)
        console.log('[DeviceInfo] Getting Android ID...');
        const androidId = await DeviceInfo.getAndroidId();

        if (androidId && androidId.length >= 8) {
          // Clean and uppercase the Android ID
          const cleanId = androidId.replace(/[^A-Z0-9]/gi, '').toUpperCase();
          console.log('[DeviceInfo] Android ID retrieved:', cleanId.substring(0, 8) + '...');
          return cleanId;
        } else {
          console.warn('[DeviceInfo] Android ID too short or invalid');
        }
      }

      // For iOS: Use unique device ID
      const uniqueId = await DeviceInfo.getUniqueId();
      console.log('[DeviceInfo] Using unique device ID');

      // Ensure it's at least 8 characters and alphanumeric
      const cleanId = uniqueId.replace(/[^A-Z0-9]/gi, '').toUpperCase();

      if (cleanId.length >= 8) {
        return cleanId;
      } else {
        // Pad with platform identifier if too short
        return (cleanId + Platform.OS.toUpperCase() + '00000000').substring(0, 32);
      }
    } catch (requireError) {
      // react-native-device-info not installed, use fallback
      console.warn('[DeviceInfo] react-native-device-info not found, using fallback ID');
      console.warn('[DeviceInfo] Install: npm install react-native-device-info');
    }

    // Fallback: Generate a pseudo-unique ID based on available info
    // WARNING: This is not suitable for production - install react-native-device-info
    const platformId = Platform.OS === 'ios' ? 'IOS' : 'AND';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();

    const fallbackId = `${platformId}${timestamp}${random}`;

    console.warn('[DeviceInfo] ⚠️  Using FALLBACK device ID - NOT SUITABLE FOR PRODUCTION');
    console.warn('[DeviceInfo] Please install react-native-device-info for real device IDs');

    return fallbackId.substring(0, 32);
  } catch (error) {
    console.error('[DeviceInfo] Failed to get device hardware ID:', error);
    throw new Error('Could not retrieve device hardware ID');
  }
}

/**
 * Get device information for display
 */
export async function getDeviceInfo(): Promise<{
  hardwareId: string;
  platform: string;
  osVersion: string;
}> {
  const hardwareId = await getDeviceHardwareId();

  return {
    hardwareId,
    platform: Platform.OS,
    osVersion: Platform.Version.toString(),
  };
}

/**
 * Format hardware ID for display (show first 8 chars)
 */
export function formatHardwareId(hardwareId: string): string {
  if (hardwareId.length <= 8) {
    return hardwareId;
  }
  return hardwareId.substring(0, 8).toUpperCase() + '...';
}
