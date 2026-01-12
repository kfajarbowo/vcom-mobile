import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  validateLicenseKey as validateLicenseCrypto,
  formatDate,
  LicenseConfig,
  type LicenseValidationResult,
} from '../utils/licenseCrypto';
import { getDeviceHardwareId } from '../utils/deviceInfo';

const LICENSE_STORAGE_KEY = 'vcomm_license_key';

/**
 * Validate license key format (basic check)
 * @param key - License key to validate
 * @returns true if valid format, false otherwise
 */
export const validateLicenseFormat = (key: string): boolean => {
  if (!key || typeof key !== 'string') {
    return false;
  }

  // Remove whitespace
  const cleanKey = key.trim();

  // Check format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (6 segments of 4 chars)
  const segments = cleanKey.split('-');
  if (segments.length !== LicenseConfig.KEY_SEGMENTS) {
    return false;
  }

  // Check each segment
  for (const seg of segments) {
    if (seg.length !== LicenseConfig.SEGMENT_LENGTH) {
      return false;
    }
    // Check alphanumeric only
    if (!/^[A-Za-z0-9]+$/.test(seg)) {
      return false;
    }
  }

  return true;
};

/**
 * Hash license key before storage
 * TODO: Implement proper hashing algorithm
 * Suggestions: SHA-256, bcrypt, or custom algorithm
 *
 * Example implementation with crypto-js:
 * ```
 * import CryptoJS from 'crypto-js';
 * return CryptoJS.SHA256(key).toString();
 * ```
 *
 * @param key - Raw license key
 * @returns Hashed license key (currently returns unhashed)
 */
export const hashLicenseKey = (key: string): string => {
  // PLACEHOLDER - User will implement hashing here
  console.warn('[License] Using unhashed license key - implement hashing for production');

  // For now, just normalize to uppercase
  return key.trim().toUpperCase();
};

/**
 * Save license key to AsyncStorage
 * @param key - License key to save
 */
export const saveLicenseKey = async (key: string): Promise<void> => {
  try {
    // Hash the key before storing (currently just normalizes)
    const hashedKey = hashLicenseKey(key);
    await AsyncStorage.setItem(LICENSE_STORAGE_KEY, hashedKey);
    console.log('[License] License key saved successfully');
  } catch (error) {
    console.error('[License] Failed to save license key:', error);
    throw new Error('Failed to save license key');
  }
};

/**
 * Retrieve license key from AsyncStorage
 * @returns License key or null if not set
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
 * @returns true if license exists, false otherwise
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
 * Verify license key with full cryptographic validation
 *
 * @param inputKey - License key to verify
 * @returns Promise with validation result
 */
export const verifyLicenseKey = async (
  inputKey: string
): Promise<LicenseValidationResult> => {
  try {
    // First validate basic format
    if (!validateLicenseFormat(inputKey)) {
      return {
        valid: false,
        expiryDate: null,
        hardwareId: null,
        error: 'Format license key tidak valid',
      };
    }

    // Get device hardware ID
    const deviceHardwareId = await getDeviceHardwareId();
    console.log('[License] Device Hardware ID:', deviceHardwareId.substring(0, 8));

    // Validate license key with crypto validation
    const validation = validateLicenseCrypto(inputKey, deviceHardwareId);

    if (validation.valid) {
      console.log('[License] License validation SUCCESS');
      console.log('[License] Expiry date:', formatDate(validation.expiryDate!));
      console.log('[License] Hardware match:', validation.hardwareMatch);
    } else {
      console.log('[License] License validation FAILED:', validation.error);
    }

    return validation;
  } catch (error) {
    console.error('[License] License verification error:', error);
    return {
      valid: false,
      expiryDate: null,
      hardwareId: null,
      error: 'Terjadi kesalahan saat memverifikasi license',
    };
  }
};

/**
 * Verify stored license key
 * @returns true if stored license is valid, false otherwise
 */
export const verifyStoredLicense = async (): Promise<boolean> => {
  try {
    const storedKey = await getLicenseKey();
    if (!storedKey) {
      console.log('[License] No stored license key found');
      return false;
    }

    const validation = await verifyLicenseKey(storedKey);
    return validation.valid;
  } catch (error) {
    console.error('[License] Stored license verification error:', error);
    return false;
  }
};

/**
 * Clear license key from storage
 * WARNING: This will require re-activation
 * Only use for testing/debugging
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

// Re-export license validation types
export type { LicenseValidationResult } from '../utils/licenseCrypto';
