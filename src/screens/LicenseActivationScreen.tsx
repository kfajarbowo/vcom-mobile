import React, {useState, useEffect} from 'react';
import {View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, StyleSheet, ActivityIndicator, TouchableOpacity, Clipboard} from 'react-native';
import {useForm, Controller} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {Button, Input} from '../components/ui';
import {useLicenseStore} from '../store/licenseStore';
import {getDeviceHardwareId, formatHardwareId} from '../services/licenseService';

const licenseSchema = z.object({
  licenseKey: z
    .string()
    .min(10, 'License key is too short')
    .regex(/^[A-Za-z0-9-]+$/, 'License key can only contain letters, numbers, and hyphens')
    .refine(
      (key) => {
        // Validate format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
        const segments = key.split('-');
        return segments.length === 6 && segments.every(seg => seg.length === 4);
      },
      'License key must be in format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
    ),
});

type LicenseForm = z.infer<typeof licenseSchema>;

export function LicenseActivationScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [deviceHwId, setDeviceHwId] = useState<string | null>(null);
  const [loadingDeviceInfo, setLoadingDeviceInfo] = useState(true);
  const {setLicenseKey} = useLicenseStore();

  const {
    control,
    handleSubmit,
    formState: {errors},
  } = useForm<LicenseForm>({
    resolver: zodResolver(licenseSchema),
    defaultValues: {
      licenseKey: '',
    },
  });

  // Load device hardware ID on mount
  useEffect(() => {
    const loadDeviceInfo = async () => {
      try {
        const hwId = await getDeviceHardwareId();
        setDeviceHwId(hwId);
      } catch (error) {
        console.error('[License] Failed to get device hardware ID:', error);
        setDeviceHwId('ERROR');
      } finally {
        setLoadingDeviceInfo(false);
      }
    };

    loadDeviceInfo();
  }, []);

  // Copy hardware ID to clipboard
  const handleCopyHardwareId = () => {
    if (deviceHwId && deviceHwId !== 'ERROR') {
      Clipboard.setString(deviceHwId);
      Alert.alert('Copied', 'Device Hardware ID copied to clipboard');
    }
  };

  const onSubmit = async (data: LicenseForm) => {
    try {
      setIsLoading(true);
      console.log('[License] Attempting to activate license...');

      // Validate and save license key
      const validation = await setLicenseKey(data.licenseKey);

      if (validation.valid) {
        console.log('[License] License activated successfully');

        const expiryDate = validation.expiryDate
          ? validation.expiryDate.toLocaleDateString()
          : 'Unknown';

        Alert.alert(
          'License Activated',
          `System license has been successfully activated.\n\nExpiry Date: ${expiryDate}\n\nThe application is now ready for use.`,
          [{text: 'PROCEED', onPress: () => {}}]
        );
      } else {
        // Show detailed error message
        let errorMessage = validation.error || 'Unknown error';

        if (validation.expired) {
          const expiryDate = validation.expiryDate
            ? validation.expiryDate.toLocaleDateString()
            : 'Unknown';
          errorMessage = `License key has expired.\n\nExpiry Date: ${expiryDate}\n\nPlease contact your administrator for a new license key.`;
        } else if (validation.hardwareMatch === false) {
          errorMessage = `License key is not valid for this device.\n\nYour Android ID: ${deviceHwId || 'Unknown'}\nLicense Android ID: ${validation.hardwareId}\n\nThis license is bound to a different device.`;
        }

        Alert.alert('Activation Failed', errorMessage, [{text: 'OK'}]);
      }
    } catch (error) {
      console.error('[License] Activation error:', error);

      const errorMessage = error instanceof Error ? error.message : 'Failed to activate license';

      Alert.alert(
        'Activation Failed',
        errorMessage + '\n\nPlease verify your license key and try again.',
        [{text: 'OK'}]
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={styles.innerContainer}>
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <View style={styles.logoBox}>
                <Text style={styles.logoText}>V</Text>
              </View>
            </View>
            <Text style={styles.title}>LICENSE ACTIVATION</Text>
            <Text style={styles.subtitle}>ENTER SYSTEM LICENSE KEY</Text>
            <View style={styles.divider} />
          </View>

          <View style={styles.formContainer}>
            {/* Info Box */}
            <View style={styles.infoBox}>
              <MaterialCommunityIcons name="shield-lock" size={32} color="#a6c455" />
              <Text style={styles.infoTitle}>SYSTEM AUTHORIZATION REQUIRED</Text>
              <Text style={styles.infoText}>
                This application requires a valid license key to operate. Enter the provided
                license key to activate the system.
              </Text>
            </View>

            {/* Device Hardware ID */}
            <View style={styles.deviceIdBox}>
              <Text style={styles.deviceIdLabel}>DEVICE ANDROID ID</Text>
              {loadingDeviceInfo ? (
                <ActivityIndicator size="small" color="#a6c455" />
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.hardwareIdContainer}
                    onPress={handleCopyHardwareId}
                    activeOpacity={0.7}>
                    <Text style={styles.deviceIdValue}>
                      {deviceHwId ? deviceHwId.toUpperCase() : 'ERROR'}
                    </Text>
                    <MaterialCommunityIcons name="content-copy" size={20} color="#a6c455" />
                  </TouchableOpacity>
                  <Text style={styles.deviceIdCopyHint}>
                    Tap to copy to clipboard
                  </Text>
                </>
              )}
              <Text style={styles.deviceIdHelp}>
                Provide this Android ID to your administrator to generate a license key for this device.
              </Text>
            </View>

            <Controller
              control={control}
              name="licenseKey"
              render={({field: {onChange, onBlur, value}}) => (
                <View style={styles.fieldContainer}>
                  <Text style={styles.label}>LICENSE KEY</Text>
                  <Input
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.licenseKey?.message}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  {errors.licenseKey && (
                    <Text style={styles.errorText}>{errors.licenseKey.message}</Text>
                  )}
                </View>
              )}
            />

            {/* License Requirements */}
            <View style={styles.requirementsBox}>
              <Text style={styles.requirementsTitle}>LICENSE KEY REQUIREMENTS:</Text>
              <View style={styles.requirement}>
                <MaterialCommunityIcons name="check-circle-outline" size={16} color="#666" />
                <Text style={styles.requirementText}>Format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX</Text>
              </View>
              <View style={styles.requirement}>
                <MaterialCommunityIcons name="check-circle-outline" size={16} color="#666" />
                <Text style={styles.requirementText}>Must match this device's Android ID</Text>
              </View>
              <View style={styles.requirement}>
                <MaterialCommunityIcons name="check-circle-outline" size={16} color="#666" />
                <Text style={styles.requirementText}>Must not be expired</Text>
              </View>
            </View>

            <View style={styles.warningBox}>
              <MaterialCommunityIcons name="alert" size={24} color="#ff8800" />
              <Text style={styles.warningText}>ONE-TIME ACTIVATION ONLY</Text>
              <Text style={styles.warningSubtext}>
                License cannot be changed after activation. Ensure you have the correct key.
              </Text>
            </View>

            <View style={styles.buttonContainer}>
              <Button
                title="ACTIVATE LICENSE"
                onPress={handleSubmit(onSubmit)}
                isLoading={isLoading}
              />
            </View>

            <Text style={styles.footerText}>CLASSIFIED SYSTEM - AUTHORIZED USE ONLY</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#171717',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  innerContainer: {
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 40,
    alignItems: 'center',
  },
  logoContainer: {
    marginBottom: 20,
  },
  logoBox: {
    width: 80,
    height: 80,
    backgroundColor: '#4d5d30',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#5a6b38',
  },
  logoText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#a6c455',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#a6c455',
    textAlign: 'center',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  divider: {
    height: 2,
    backgroundColor: '#4d5d30',
    width: 60,
    marginTop: 12,
  },
  formContainer: {
    gap: 20,
  },
  infoBox: {
    backgroundColor: '#1a1a1a',
    padding: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#4d5d30',
    alignItems: 'center',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#a6c455',
    marginTop: 12,
    marginBottom: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  infoText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.3,
  },
  fieldContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  errorText: {
    color: '#ff4444',
    fontSize: 11,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  requirementsBox: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  requirementsTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#888',
    marginBottom: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  requirement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  requirementText: {
    fontSize: 11,
    color: '#666',
    letterSpacing: 0.3,
  },
  warningBox: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#ff8800',
    alignItems: 'center',
  },
  warningText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#ff8800',
    marginTop: 8,
    marginBottom: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  warningSubtext: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  buttonContainer: {
    marginTop: 12,
  },
  footerText: {
    fontSize: 9,
    color: '#a6c455',
    textAlign: 'center',
    marginTop: 32,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  deviceIdBox: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#4d5d30',
    alignItems: 'center',
  },
  deviceIdLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#888',
    marginBottom: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  hardwareIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 4,
    marginBottom: 8,
  },
  deviceIdValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#a6c455',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 1,
    flex: 1,
  },
  deviceIdCopyHint: {
    fontSize: 9,
    color: '#888',
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  deviceIdHelp: {
    fontSize: 10,
    color: '#666',
    textAlign: 'center',
    letterSpacing: 0.3,
    lineHeight: 14,
  },
});
