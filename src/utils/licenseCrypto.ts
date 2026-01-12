/**
 * License Crypto Module for React Native
 * Handles cryptographic validation for the license system.
 *
 * Features:
 * - License key validation with embedded expiry and Hardware ID (pre-binding)
 * - Checksum validation for tamper detection
 * - Compatible with desktop license generator
 *
 * @module utils/licenseCrypto
 */

import CryptoJS from 'crypto-js';

/**
 * Configuration for cryptographic operations
 */
const CONFIG = {
  KEY_SEGMENTS: 6,
  SEGMENT_LENGTH: 4,
  CHARSET: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  SECRET_KEY: 'eyesee-license-secret-key-2024-v1',
  PRODUCT_CODE: 'ES01',
};

/**
 * Decode a base36 string to number
 *
 * @param str - Base36 string
 * @returns Decoded number
 */
function decodeBase36(str: string): number {
  const chars = CONFIG.CHARSET;
  let result = 0;

  for (let i = 0; i < str.length; i++) {
    result = result * chars.length + chars.indexOf(str[i]);
  }

  return result;
}

/**
 * Encode a number to base36 string
 *
 * @param num - Number to encode
 * @param length - Desired output length
 * @returns Base36 encoded string
 */
function encodeBase36(num: number, length: number): string {
  const chars = CONFIG.CHARSET;
  let result = '';

  while (num > 0) {
    result = chars[num % chars.length] + result;
    num = Math.floor(num / chars.length);
  }

  // Pad with leading characters if needed
  while (result.length < length) {
    result = chars[0] + result;
  }

  return result.substring(0, length);
}

/**
 * Generate checksum for license key
 *
 * @param data - Data to checksum
 * @returns 4-character checksum
 */
function generateChecksum(data: string): string {
  const hash = CryptoJS.HmacSHA256(data, CONFIG.SECRET_KEY).toString();

  // Take first 8 characters and convert to our charset
  const num = parseInt(hash.substring(0, 8), 16);
  return encodeBase36(num, CONFIG.SEGMENT_LENGTH);
}

export interface LicenseValidationResult {
  valid: boolean;
  expiryDate: Date | null;
  hardwareId: string | null;
  error: string | null;
  expired?: boolean;
  hardwareMatch?: boolean;
}

/**
 * Validate and decode a license key
 *
 * @param licenseKey - License key to validate
 * @param deviceHardwareId - Current device hardware ID (IMEI) for matching
 * @returns Validation result with expiry date and embedded hardware ID
 */
export function validateLicenseKey(
  licenseKey: string,
  deviceHardwareId?: string
): LicenseValidationResult {
  const result: LicenseValidationResult = {
    valid: false,
    expiryDate: null,
    hardwareId: null,
    error: null,
  };

  // Check format
  const cleanKey = licenseKey.trim().toUpperCase();
  const segments = cleanKey.split('-');

  if (segments.length !== CONFIG.KEY_SEGMENTS) {
    result.error = 'Format key tidak valid. Gunakan format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX';
    return result;
  }

  // Check each segment length
  for (const seg of segments) {
    if (seg.length !== CONFIG.SEGMENT_LENGTH) {
      result.error = 'Format key tidak valid';
      return result;
    }

    // Check valid characters
    for (const char of seg) {
      if (!CONFIG.CHARSET.includes(char)) {
        result.error = 'Karakter tidak valid dalam key';
        return result;
      }
    }
  }

  const [seg1, seg2, seg3, seg4, seg5, seg6] = segments;

  // Verify checksum (of first 5 segments)
  const dataToCheck = seg1 + seg2 + seg3 + seg4 + seg5;
  const expectedChecksum = generateChecksum(dataToCheck);

  if (seg6 !== expectedChecksum) {
    result.error = 'License key tidak valid (checksum mismatch)';
    return result;
  }

  // Verify product code
  const productCode = seg1.substring(2, 4) + seg2.substring(0, 2);
  if (productCode !== CONFIG.PRODUCT_CODE) {
    result.error = 'Product code tidak valid';
    return result;
  }

  // Extract Hardware ID from seg4 + seg5
  const embeddedHardwareId = seg4 + seg5;

  // Decode expiry date
  const daysFromEpoch = decodeBase36(seg3);
  const expiryMs = daysFromEpoch * 1000 * 60 * 60 * 24 * 10;
  const expiryDate = new Date(expiryMs);

  // Sanity check: expiry should be reasonable (2020-2100)
  const minDate = new Date('2020-01-01');
  const maxDate = new Date('2100-01-01');

  if (expiryDate < minDate || expiryDate > maxDate) {
    result.error = 'Tanggal expired tidak valid dalam key';
    return result;
  }

  // Check if expired
  const now = new Date();
  const expired = expiryDate < now;

  // Check hardware ID match if provided
  let hardwareMatch = true;
  if (deviceHardwareId) {
    const deviceHwNormalized = deviceHardwareId.toUpperCase().substring(0, 8);
    hardwareMatch = embeddedHardwareId === deviceHwNormalized;

    if (!hardwareMatch) {
      result.error = 'License key tidak cocok dengan perangkat ini';
      result.hardwareId = embeddedHardwareId;
      result.expiryDate = expiryDate;
      result.expired = expired;
      result.hardwareMatch = false;
      return result;
    }
  }

  if (expired) {
    result.error = 'License key sudah expired';
    result.valid = false;
    result.expiryDate = expiryDate;
    result.hardwareId = embeddedHardwareId;
    result.expired = true;
    result.hardwareMatch = hardwareMatch;
    return result;
  }

  result.valid = true;
  result.expiryDate = expiryDate;
  result.hardwareId = embeddedHardwareId;
  result.expired = false;
  result.hardwareMatch = hardwareMatch;

  return result;
}

/**
 * Format date for display
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export const LicenseConfig = {
  PRODUCT_CODE: CONFIG.PRODUCT_CODE,
  KEY_SEGMENTS: CONFIG.KEY_SEGMENTS,
  SEGMENT_LENGTH: CONFIG.SEGMENT_LENGTH,
};
