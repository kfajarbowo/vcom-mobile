import React, {useState, useEffect} from 'react';
import {View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, StyleSheet, ActivityIndicator, TouchableOpacity, Clipboard, TextInput} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {Button, Input} from '../components/ui';
import {useLicenseStore} from '../store/licenseStore';
import {getDeviceHardwareId, formatHardwareId, setLicenseServer} from '../services/licenseService';
import {STORAGE_KEYS} from '../services/apiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function LicenseActivationScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [deviceHwId, setDeviceHwId] = useState<string | null>(null);
  const [loadingDeviceInfo, setLoadingDeviceInfo] = useState(true);
  const [licenseKey, setLicenseKeyInput] = useState('');
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverHost, setServerHost] = useState('');
  const [serverPort, setServerPort] = useState('');
  const [statusMessage, setStatusMessage] = useState<{type: 'success' | 'warning' | 'error'; title: string; message: string} | null>(null);

  const {activateKey, checkKey} = useLicenseStore();

  // Load device hardware ID and server settings on mount
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

    const loadServerSettings = async () => {
      try {
        const savedHost = await AsyncStorage.getItem(STORAGE_KEYS.LICENSE_SERVER_HOST);
        const savedPort = await AsyncStorage.getItem(STORAGE_KEYS.LICENSE_SERVER_PORT);
        if (savedHost) setServerHost(savedHost);
        if (savedPort) setServerPort(savedPort);
      } catch (error) {
        console.error('[License] Error loading server settings:', error);
      }
    };

    loadDeviceInfo();
    loadServerSettings();
  }, []);

  const handleCopyHardwareId = () => {
    if (deviceHwId && deviceHwId !== 'ERROR') {
      Clipboard.setString(deviceHwId);
      Alert.alert('Copied', 'Device Hardware ID copied to clipboard');
    }
  };

  const handleServerSettingsSave = async () => {
    try {
      await setLicenseServer(serverHost, serverPort);
      Alert.alert('Success', `License server set to ${serverHost}:${serverPort}`, [{text: 'OK'}]);
      setShowServerSettings(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to save server settings');
    }
  };

  const handleCheckKey = async () => {
    const key = licenseKey.trim();
    if (!key) {
      Alert.alert('Error', 'Please enter a license key');
      return;
    }

    setIsChecking(true);
    setStatusMessage(null);
    try {
      const result = await checkKey(key);

      if (result.valid && result.status === 'AVAILABLE') {
        setStatusMessage({
          type: 'success',
          title: 'Available',
          message: `Product: ${result.productName || result.productCode}\nStatus: Not activated yet - ready to activate`,
        });
      } else if (result.valid && result.status === 'ALREADY_ACTIVATED') {
        setStatusMessage({
          type: 'warning',
          title: 'Already Used',
          message: `Product: ${result.productCode}\nActivated by: ${(result.activatedBy || '').substring(0, 20)}...\nUsed at: ${result.usedAt ? new Date(result.usedAt).toLocaleString() : 'Unknown'}`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          title: result.status || 'Invalid',
          message: result.message || result.error || 'Invalid license key',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        title: 'Connection Error',
        message: `Cannot connect to server at ${serverHost}:${serverPort}`,
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleActivate = async () => {
    const key = licenseKey.trim();
    if (!key) {
      Alert.alert('Error', 'Please enter a license key');
      return;
    }

    Alert.alert(
      'Activate License',
      'Are you sure you want to activate this license key? This action cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'ACTIVATE',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            setStatusMessage(null);
            try {
              const result = await activateKey(key);

              if (result.success) {
                setStatusMessage({
                  type: 'success',
                  title: 'Activated',
                  message: `License activated successfully!\nProduct: ${result.productCode}`,
                });

                Alert.alert(
                  'License Activated',
                  `System license has been successfully activated.\n\nProduct: ${result.productCode}\n\nThe application is now ready for use.`,
                  [{text: 'PROCEED', onPress: () => {}}]
                );
              } else {
                setStatusMessage({
                  type: 'error',
                  title: 'Activation Failed',
                  message: result.error || 'Unknown error',
                });
                Alert.alert('Activation Failed', result.error || 'Unknown error', [{text: 'OK'}]);
              }
            } catch (error: any) {
              const errorMessage = error.message || 'Failed to activate license';
              setStatusMessage({
                type: 'error',
                title: 'Error',
                message: errorMessage,
              });
              Alert.alert('Activation Failed', errorMessage, [{text: 'OK'}]);
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={styles.innerContainer}>
          {/* Server Settings Toggle */}
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => setShowServerSettings(!showServerSettings)}>
            <MaterialCommunityIcons
              name="cog"
              size={24}
              color={showServerSettings ? '#a6c455' : '#666'}
            />
          </TouchableOpacity>

          {/* Server Settings Panel */}
          {showServerSettings && (
            <View style={styles.serverSettingsBox}>
              <Text style={styles.serverSettingsTitle}>LICENSE SERVER SETTINGS</Text>
              <View style={styles.serverSettingsRow}>
                <View style={{flex: 2}}>
                  <Text style={styles.label}>HOST</Text>
                  <TextInput
                    style={styles.serverInput}
                    value={serverHost}
                    onChangeText={setServerHost}
                    placeholder="license server IP"
                    placeholderTextColor="#555"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <View style={{flex: 1, marginLeft: 12}}>
                  <Text style={styles.label}>PORT</Text>
                  <TextInput
                    style={styles.serverInput}
                    value={serverPort}
                    onChangeText={setServerPort}
                    placeholder="port"
                    placeholderTextColor="#555"
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <TouchableOpacity style={styles.saveServerButton} onPress={handleServerSettingsSave}>
                <Text style={styles.saveServerButtonText}>SAVE SERVER SETTINGS</Text>
              </TouchableOpacity>
            </View>
          )}

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

            {/* License Key Input */}
            <View style={styles.fieldContainer}>
              <Text style={styles.label}>LICENSE KEY</Text>
              <Input
                placeholder="Enter license key"
                value={licenseKey}
                onChangeText={setLicenseKeyInput}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>

            {/* Status Message */}
            {statusMessage && (
              <View style={[
                styles.statusBox,
                statusMessage.type === 'success' && styles.statusSuccess,
                statusMessage.type === 'warning' && styles.statusWarning,
                statusMessage.type === 'error' && styles.statusError,
              ]}>
                <MaterialCommunityIcons
                  name={
                    statusMessage.type === 'success' ? 'check-circle' :
                    statusMessage.type === 'warning' ? 'alert-circle' : 'close-circle'
                  }
                  size={24}
                  color={
                    statusMessage.type === 'success' ? '#a6c455' :
                    statusMessage.type === 'warning' ? '#ff8800' : '#ff4444'
                  }
                />
                <Text style={[
                  styles.statusTitle,
                  statusMessage.type === 'success' && {color: '#a6c455'},
                  statusMessage.type === 'warning' && {color: '#ff8800'},
                  statusMessage.type === 'error' && {color: '#ff4444'},
                ]}>{statusMessage.title}</Text>
                <Text style={styles.statusMessage}>{statusMessage.message}</Text>
              </View>
            )}

            {/* Buttons */}
            <View style={styles.buttonRow}>
              <View style={{flex: 1}}>
                <Button
                  title="CHECK KEY"
                  onPress={handleCheckKey}
                  isLoading={isChecking}
                  variant="outline"
                />
              </View>
              <View style={{flex: 1, marginLeft: 12}}>
                <Button
                  title="ACTIVATE"
                  onPress={handleActivate}
                  isLoading={isLoading}
                />
              </View>
            </View>

            <View style={styles.warningBox}>
              <MaterialCommunityIcons name="alert" size={24} color="#ff8800" />
              <Text style={styles.warningText}>ONE-TIME ACTIVATION ONLY</Text>
              <Text style={styles.warningSubtext}>
                License cannot be changed after activation. Ensure you have the correct key.
              </Text>
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
  settingsButton: {
    position: 'absolute',
    top: -8,
    right: 0,
    padding: 8,
    zIndex: 10,
  },
  serverSettingsBox: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#4d5d30',
    marginBottom: 20,
  },
  serverSettingsTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#a6c455',
    marginBottom: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  serverSettingsRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  serverInput: {
    backgroundColor: '#2a2a2a',
    color: '#fff',
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#333',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  saveServerButton: {
    backgroundColor: '#4d5d30',
    padding: 10,
    borderRadius: 4,
    alignItems: 'center',
  },
  saveServerButtonText: {
    color: '#a6c455',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
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
    marginBottom: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statusBox: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
  },
  statusSuccess: {
    borderColor: '#4d5d30',
  },
  statusWarning: {
    borderColor: '#ff8800',
  },
  statusError: {
    borderColor: '#ff4444',
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  statusMessage: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.3,
  },
  buttonRow: {
    flexDirection: 'row',
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
