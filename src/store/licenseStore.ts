import {create} from 'zustand';
import {
  saveLicenseKey,
  checkLicenseOnServer,
  activateLicenseOnServer,
  type LicenseCheckResult,
} from '../services/licenseService';

export interface LicenseActivateResult {
  success: boolean;
  productCode?: string;
  error?: string;
}

interface LicenseState {
  licenseKey: string | null;
  isLicenseValid: boolean;
  isLoading: boolean;
  hasCheckedLicense: boolean;
  lastValidationError: string | null;
  initialize: () => Promise<void>;
  checkKey: (key: string) => Promise<LicenseCheckResult>;
  activateKey: (key: string) => Promise<LicenseActivateResult>;
}

export const useLicenseStore = create<LicenseState>((set) => ({
  licenseKey: 'BYPASSED',
  isLicenseValid: true,
  isLoading: false,
  hasCheckedLicense: true,
  lastValidationError: null,

  initialize: async () => {
    console.log('[License] License check bypassed');
    set({
      licenseKey: 'BYPASSED',
      isLicenseValid: true,
      isLoading: false,
      hasCheckedLicense: true,
      lastValidationError: null,
    });
  },

  checkKey: async (key: string) => {
    console.log('[License] Checking key on server...');
    const result = await checkLicenseOnServer(key);
    return result;
  },

  activateKey: async (key: string) => {
    try {
      console.log('[License] Checking key availability...');

      // Step 1: Check if key is available
      const checkResult = await checkLicenseOnServer(key);

      if (checkResult.status === 'ALREADY_ACTIVATED') {
        set({ lastValidationError: 'License key has already been activated' });
        return {
          success: false,
          error: `This key is already activated.\nActivated by: ${(checkResult.activatedBy || '').substring(0, 20)}...\nUsed at: ${checkResult.usedAt ? new Date(checkResult.usedAt).toLocaleString() : 'Unknown'}`,
        };
      }

      if (!checkResult.valid || checkResult.status !== 'AVAILABLE') {
        set({ lastValidationError: checkResult.error || 'Invalid license key' });
        return {
          success: false,
          error: checkResult.message || checkResult.error || 'Invalid license key',
        };
      }

      // Step 2: Activate (mark as used) on server
      console.log('[License] Key available, activating...');
      const activationResult = await activateLicenseOnServer(key);

      if (!activationResult.success) {
        set({ lastValidationError: activationResult.error || 'Activation failed' });
        return {
          success: false,
          error: activationResult.error || 'Activation failed',
        };
      }

      // Step 3: Save locally
      console.log('[License] Activated on server, saving locally...');
      await saveLicenseKey(key);

      set({
        licenseKey: key,
        isLicenseValid: true,
        lastValidationError: null,
      });

      console.log('[License] License activated successfully');
      return {
        success: true,
        productCode: activationResult.productCode,
      };
    } catch (error) {
      console.error('[License] Failed to activate license:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to activate license';
      set({ lastValidationError: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  },
}));
