import {create} from 'zustand';
import {
  saveLicenseKey,
  getLicenseKey,
  isLicenseSet,
  validateLicenseFormat,
  verifyStoredLicense,
  verifyLicenseKey,
  type LicenseValidationResult,
} from '../services/licenseService';

interface LicenseState {
  licenseKey: string | null;
  isLicenseValid: boolean;
  isLoading: boolean;
  hasCheckedLicense: boolean;
  lastValidationError: string | null;
  initialize: () => Promise<void>;
  setLicenseKey: (key: string) => Promise<LicenseValidationResult>;
}

export const useLicenseStore = create<LicenseState>((set) => ({
  licenseKey: null,
  isLicenseValid: false,
  isLoading: true,
  hasCheckedLicense: false,
  lastValidationError: null,

  initialize: async () => {
    try {
      console.log('[License] Initializing license check...');
      set({isLoading: true});

      // Check if license key exists in storage
      const hasLicense = await isLicenseSet();

      if (hasLicense) {
        const storedKey = await getLicenseKey();
        console.log('[License] Found existing license key, verifying...');

        // Verify the stored license with full validation
        const isValid = await verifyStoredLicense();

        set({
          licenseKey: storedKey,
          isLicenseValid: isValid,
          isLoading: false,
          hasCheckedLicense: true,
          lastValidationError: isValid ? null : 'Stored license is no longer valid',
        });

        if (!isValid) {
          console.warn('[License] Stored license key is invalid or expired');
        }
      } else {
        console.log('[License] No license key found - first launch');
        set({
          licenseKey: null,
          isLicenseValid: false,
          isLoading: false,
          hasCheckedLicense: true,
          lastValidationError: null,
        });
      }
    } catch (error) {
      console.error('[License] Failed to initialize license:', error);
      // On error, assume no license (fail-safe to activation screen)
      set({
        licenseKey: null,
        isLicenseValid: false,
        isLoading: false,
        hasCheckedLicense: true,
        lastValidationError: 'Failed to initialize license',
      });
    }
  },

  setLicenseKey: async (key: string) => {
    try {
      console.log('[License] Validating license key...');

      // Validate with full crypto validation
      const validation = await verifyLicenseKey(key);

      if (!validation.valid) {
        set({
          lastValidationError: validation.error,
        });
        return validation;
      }

      console.log('[License] License key valid, saving...');

      // Save to AsyncStorage
      await saveLicenseKey(key);

      // Update state
      set({
        licenseKey: key,
        isLicenseValid: true,
        lastValidationError: null,
      });

      console.log('[License] License activated successfully');
      return validation;
    } catch (error) {
      console.error('[License] Failed to set license key:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to set license key';
      set({
        lastValidationError: errorMessage,
      });
      return {
        valid: false,
        expiryDate: null,
        hardwareId: null,
        error: errorMessage,
      };
    }
  },
}));
