import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from './apiClient';
import { getDeviceHardwareId } from '../utils/deviceInfo';
import { resolveHostname } from '../utils/dnsMap';

const LICENSE_STORAGE_KEY = 'vcomm_license_key';

/**
 * Get license server base URL
 */
export const getLicenseServerUrl = async (): Promise<string> => {
  const protocol = 'http';
  let host = 'blm.id';
  let port = '3001';

  try {
    const storedHost = await AsyncStorage.getItem(STORAGE_KEYS.LICENSE_SERVER_HOST);
    const storedPort = await AsyncStorage.getItem(STORAGE_KEYS.LICENSE_SERVER_PORT);

    if (storedHost) {host = storedHost;}
    if (storedPort) {port = storedPort;}
  } catch (error) {
    console.error('[License] Error reading license server config from storage:', error);
  }

  // Lihat catatan di getApiBaseUrl(): hostname internal ditukar menjadi IP
  // karena jaringan lapangan tidak punya server DNS.
  host = await resolveHostname(host);

  console.log(`[License] Using license server: ${protocol}://${host}:${port}`);
  return `${protocol}://${host}:${port}`;
};

/**
 * Set license server configuration
 */
export const setLicenseServer = async (host: string, port: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.LICENSE_SERVER_HOST, host);
    await AsyncStorage.setItem(STORAGE_KEYS.LICENSE_SERVER_PORT, port);
    console.log('[License] License server config saved');
  } catch (error) {
    console.error('[License] Error saving license server config:', error);
  }
};

export interface LicenseCheckResult {
  valid: boolean;
  status: 'AVAILABLE' | 'ALREADY_ACTIVATED' | 'INVALID' | 'ERROR';
  productCode?: string;
  productName?: string;
  activatedBy?: string;
  usedAt?: string;
  message?: string;
  error?: string;
}

export interface LicenseActivationResult {
  success: boolean;
  productCode?: string;
  testHardwareId?: string;
  error?: string;
}

/**
 * Check license key status on server
 */
export const checkLicenseOnServer = async (licenseKey: string): Promise<LicenseCheckResult> => {
  try {
    const baseUrl = await getLicenseServerUrl();
    console.log('[License] Checking key on server:', baseUrl);

    const res = await fetch(`${baseUrl}/api/license/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
    });
    const data = await res.json();

    if (data.valid && data.status === 'AVAILABLE') {
      return {
        valid: true,
        status: 'AVAILABLE',
        productCode: data.productCode,
        productName: data.productName,
      };
    } else if (data.valid && data.status === 'ALREADY_ACTIVATED') {
      return {
        valid: true,
        status: 'ALREADY_ACTIVATED',
        productCode: data.productCode,
        activatedBy: data.activatedBy,
        usedAt: data.usedAt,
      };
    } else {
      return {
        valid: false,
        status: data.status || 'INVALID',
        message: data.message || data.error,
        error: data.message || data.error,
      };
    }
  } catch (err: any) {
    console.error('[License] Server check error:', err);
    return {
      valid: false,
      status: 'ERROR',
      error: `Cannot connect to server: ${err.message}`,
    };
  }
};

/**
 * Activate (mark as used) a license key on server
 */
export const activateLicenseOnServer = async (licenseKey: string): Promise<LicenseActivationResult> => {
  try {
    const baseUrl = await getLicenseServerUrl();
    console.log('[License] Activating key on server:', baseUrl);

    const hardwareId = await getDeviceHardwareId();
    let deviceName = 'VCOMM-Mobile';
    try {
      const DeviceInfo = require('react-native-device-info');
      deviceName = await DeviceInfo.getDeviceName();
    } catch (e) {
      console.warn('[License] react-native-device-info not available for deviceName');
    }

    const res = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey,
        hardwareId,
        deviceName,
      }),
    });
    const data = await res.json();

    if (data.success) {
      return {
        success: true,
        productCode: data.productCode,
        testHardwareId: data.testHardwareId,
      };
    } else {
      return {
        success: false,
        error: data.error || 'Activation failed',
      };
    }
  } catch (err: any) {
    console.error('[License] Server activation error:', err);
    return {
      success: false,
      error: `Cannot connect to server: ${err.message}`,
    };
  }
};

/**
 * Save license key to AsyncStorage
 */
export const saveLicenseKey = async (key: string): Promise<void> => {
  try {
    const normalizedKey = key.trim().toUpperCase();
    await AsyncStorage.setItem(LICENSE_STORAGE_KEY, normalizedKey);
    console.log('[License] License key saved successfully');
  } catch (error) {
    console.error('[License] Failed to save license key:', error);
    throw new Error('Failed to save license key');
  }
};

/**
 * Retrieve license key from AsyncStorage
 */
export const getLicenseKey = async (): Promise<string | null> => {
  try {
    const key = await AsyncStorage.getItem(LICENSE_STORAGE_KEY);
    return key;
  } catch (error) {
    console.error('[License] Failed to retrieve license key:', error);
    return null;
  }
};

/**
 * Check if license key is set
 */
export const isLicenseSet = async (): Promise<boolean> => {
  try {
    const key = await getLicenseKey();
    return key !== null && key !== '';
  } catch (error) {
    console.error('[License] Failed to check license status:', error);
    return false;
  }
};

/**
 * Verify stored license - checks if a key exists locally
 * (Key was already validated with server during activation)
 */
export const verifyStoredLicense = async (): Promise<boolean> => {
  try {
    const storedKey = await getLicenseKey();
    if (!storedKey) {
      console.log('[License] No stored license key found');
      return false;
    }
    console.log('[License] Found stored license key');
    return true;
  } catch (error) {
    console.error('[License] Stored license verification error:', error);
    return false;
  }
};

/**
 * Clear license key from storage
 * WARNING: This will require re-activation
 */
export const clearLicenseKey = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(LICENSE_STORAGE_KEY);
    console.log('[License] License key cleared');
  } catch (error) {
    console.error('[License] Failed to clear license key:', error);
    throw new Error('Failed to clear license key');
  }
};

// Re-export device info utilities
export { getDeviceHardwareId, getDeviceInfo, formatHardwareId } from '../utils/deviceInfo';
