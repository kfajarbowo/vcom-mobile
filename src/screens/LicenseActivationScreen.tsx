import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, StyleSheet, ActivityIndicator, TouchableOpacity, Clipboard, TextInput, Switch, Modal, FlatList } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { Button, Input } from '../components/ui';
import { useLicenseStore } from '../store/licenseStore';
import { getDeviceHardwareId, setLicenseServer } from '../services/licenseService';
import { STORAGE_KEYS } from '../services/apiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchCustomSites, checkAllSitesStatus, Site } from '../services/siteService';

export function LicenseActivationScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isModalVisible, setModalVisible] = useState(false);
  const [deviceHwId, setDeviceHwId] = useState<string | null>(null);
  const [loadingDeviceInfo, setLoadingDeviceInfo] = useState(true);
  const [licenseKey, setLicenseKeyInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'warning' | 'error'; title: string; message: string } | null>(null);

  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverHost, setServerHost] = useState('blm.id');
  const [serverPort, setServerPort] = useState('3001');
  const [isPortEnabled, setIsPortEnabled] = useState(false);
  const [customSites, setCustomSites] = useState<Site[]>([]);
  const [siteStatuses, setSiteStatuses] = useState<Record<string, boolean | null>>({});
  const [isLoadingSites, setIsLoadingSites] = useState(false);

  const { activateKey, checkKey } = useLicenseStore();

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

    loadDeviceInfo();

    const loadServerSettings = async () => {
      try {
        const host = await AsyncStorage.getItem(STORAGE_KEYS.LICENSE_SERVER_HOST);
        const port = await AsyncStorage.getItem(STORAGE_KEYS.LICENSE_SERVER_PORT);
        if (host) {setServerHost(host);}
        if (port) {setServerPort(port);}
      } catch (error) {
        console.error('[License] Failed to load server settings:', error);
      }
    };
    loadServerSettings();
  }, []);

  // Fetch sites when settings are opened
  useEffect(() => {
    if (showServerSettings && customSites.length === 0) {
      const loadSites = async () => {
        setIsLoadingSites(true);
        const sites = await fetchCustomSites('blm');
        if (sites.length === 0) {
          Alert.alert('Connection Note', 'Could not retrieve site list from the remote server. You can try again or check your internet connection.');
        }
        setCustomSites(sites);

        // Check connectivity for all sites (license server uses port 3001)
        setSiteStatuses(Object.fromEntries(sites.map(s => [s.ip, null])));
        const statuses = await checkAllSitesStatus(sites, parseInt(serverPort, 10) || 3001);
        setSiteStatuses(statuses);

        // Auto-deselect if the currently selected site is offline
        if (statuses[serverHost] === false) {
          Alert.alert('Site Offline', `${serverHost} is unreachable. Reverting to default.`);
          setServerHost('blm.id');
        }

        setIsLoadingSites(false);
      };
      loadSites();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showServerSettings, customSites.length]);

  const handleCopyHardwareId = () => {
    if (deviceHwId && deviceHwId !== 'ERROR') {
      Clipboard.setString(deviceHwId);
      Alert.alert('Copied', 'Device Hardware ID copied to clipboard');
    }
  };

  const handleSaveServerSettings = async () => {
    try {
      await setLicenseServer(serverHost, serverPort);
      setShowServerSettings(false);
      Alert.alert('Success', 'License server settings saved.');
    } catch (error) {
      Alert.alert('Error', 'Failed to save license server settings.');
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
        message: 'Cannot connect to license server',
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
        { text: 'Cancel', style: 'cancel' },
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
                  [{ text: 'PROCEED', onPress: () => { } }]
                );
              } else {
                setStatusMessage({
                  type: 'error',
                  title: 'Activation Failed',
                  message: result.error || 'Unknown error',
                });
                Alert.alert('Activation Failed', result.error || 'Unknown error', [{ text: 'OK' }]);
              }
            } catch (error: any) {
              const errorMessage = error.message || 'Failed to activate license';
              setStatusMessage({
                type: 'error',
                title: 'Error',
                message: errorMessage,
              });
              Alert.alert('Activation Failed', errorMessage, [{ text: 'OK' }]);
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleLicenseKeyChange = (text: string) => {
    // Remove non-alphanumeric characters and convert to uppercase
    const cleaned = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    // Add dashes after every 4 characters
    let formatted = '';
    for (let i = 0; i < cleaned.length && i < 16; i++) {
      if (i > 0 && i % 4 === 0) {
        formatted += '-';
      }
      formatted += cleaned[i];
    }

    setLicenseKeyInput(formatted);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

      <TouchableOpacity
        style={styles.settingsGearButton}
        onPress={() => setShowServerSettings(!showServerSettings)}
        activeOpacity={0.7}>
        <MaterialCommunityIcons name="cog" size={24} color="#a6c455" />
      </TouchableOpacity>

      {showServerSettings && (
        <View style={styles.serverSettingsDropdown}>
          <View style={styles.serverSettingsHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <MaterialCommunityIcons name="server-network" size={20} color="#a6c455" />
              <Text style={styles.serverSettingsTitle}>SERVER CONFIGURATION</Text>
            </View>
            <TouchableOpacity onPress={() => setShowServerSettings(false)} activeOpacity={0.7} style={{ padding: 4 }}>
              <MaterialCommunityIcons name="close" size={20} color="#666" />
            </TouchableOpacity>
          </View>
          <View style={styles.serverSettingsContent}>
            <Text style={styles.serverSettingsInfo}>
              Configure license server address
            </Text>
            <View style={styles.fieldContainer}>
              <Text style={styles.label}>LICENSE HOST ADDRESS</Text>
              <View style={styles.quickSelectContainer}>
                {['blm.id'].map((domain) => (
                  <TouchableOpacity
                    key={domain}
                    style={[styles.quickSelectButton, serverHost === domain && styles.quickSelectButtonActive]}
                    onPress={() => {
                      setServerHost(domain);
                      setServerPort('3001');
                    }}>
                    <Text style={[styles.quickSelectButtonText, serverHost === domain && styles.quickSelectButtonTextActive]}>
                      {domain}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[styles.quickSelectButton, serverHost !== 'blm.id' && styles.quickSelectButtonActive]}
                  onPress={() => setServerHost('')}>
                  <Text style={[styles.quickSelectButtonText, serverHost !== 'blm.id' && styles.quickSelectButtonTextActive]}>
                    Custom
                  </Text>
                </TouchableOpacity>
              </View>

              {serverHost !== 'blm.id' && (
                <View>
                  {/* The "Dropdown" Trigger Button */}
                  <TouchableOpacity
                    style={styles.dropdownTrigger}
                    onPress={() => setModalVisible(true)}
                  >
                    <Text style={styles.dropdownTriggerText}>
                      {customSites.find(s => s.ip === serverHost)?.label || 'Select Site'}
                    </Text>
                    <Text style={{ color: '#999' }}>
                      {isLoadingSites ? <ActivityIndicator size="small" color="#a6c455" /> : '▼'}
                    </Text>
                  </TouchableOpacity>

                  <Modal visible={isModalVisible} transparent animationType="fade">
                    <TouchableOpacity
                      style={styles.modalOverlay}
                      activeOpacity={1}
                      onPress={() => setModalVisible(false)}
                    >
                      <View style={styles.modalContent}>
                        <FlatList
                          data={customSites}
                          keyExtractor={(item) => item.label + item.ip}
                          ListEmptyComponent={
                            <View style={{ padding: 20, alignItems: 'center' }}>
                              <Text style={{ color: '#888', marginBottom: 12 }}>No sites available</Text>
                              <TouchableOpacity
                                onPress={async () => {
                                  setIsLoadingSites(true);
                                  const sites = await fetchCustomSites('blm');
                                  setCustomSites(sites);
                                  setIsLoadingSites(false);
                                }}
                                style={styles.quickSelectButton}
                              >
                                <Text style={styles.quickSelectButtonText}>RETRY FETCH</Text>
                              </TouchableOpacity>
                            </View>
                          }
                          renderItem={({ item }) => {
                            const status = siteStatuses[item.ip];
                            return (
                            <TouchableOpacity
                              style={[
                                styles.quickSelectSiteButton,
                                serverHost === item.ip && styles.quickSelectSiteButtonActive,
                              ]}
                              onPress={() => {
                                if (status === false) {
                                  Alert.alert('Site Offline', `${item.label} (${item.ip}) is currently unreachable. Please select a different site.`);
                                  return;
                                }
                                // Prefer the blmIp for license activation
                                setServerHost(item.blmIp || item.ip);
                                setServerPort('3001');
                                setModalVisible(false);
                              }}
                            >
                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                  <View style={[
                                    styles.statusDot,
                                    status === true && styles.statusDotOnline,
                                    status === false && styles.statusDotOffline,
                                    status === null && styles.statusDotChecking,
                                  ]} />
                                  <Text style={[
                                    styles.quickSelectSiteButtonText,
                                    serverHost === item.ip && styles.quickSelectButtonTextActive,
                                  ]}>
                                    {item.label}
                                  </Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 14 }}>
                                  <Text style={styles.ipSubtext}>{item.ip}</Text>
                                  <Text style={[
                                    styles.statusText,
                                    status === true && styles.statusTextOnline,
                                    status === false && styles.statusTextOffline,
                                  ]}>
                                    {status === true ? '  Online' : status === false ? '  Offline' : '  Checking...'}
                                  </Text>
                                </View>
                              </View>
                              {serverHost === item.ip && <Text style={{ color: '#a6c455' }}>✓</Text>}
                            </TouchableOpacity>
                            );
                          }}
                        />
                      </View>
                    </TouchableOpacity>
                  </Modal>
                </View>

                // <View style={styles.customSiteContainer}>
                //   {Object.entries({
                //     'Site 1': '192.168.1.1',
                //     'Site 2': '192.168.1.2',
                //     'Site 3': '192.168.1.3',
                //   }).map(([label, ip]) => (
                //     <TouchableOpacity
                //       key={label}
                //       style={[
                //         styles.quickSelectSiteButton,
                //         serverHost === ip && styles.quickSelectSiteButtonActive,
                //       ]}
                //       onPress={() => {
                //         setServerHost(ip);
                //         setServerPort('3001');
                //       }}
                //     >
                //       <Text
                //         style={[
                //           styles.quickSelectSiteButtonText,
                //           serverHost === ip && styles.quickSelectSiteButtonTextActive,
                //         ]}
                //       >
                //         {label} : {ip}
                //       </Text>
                //     </TouchableOpacity>
                //   ))}
                // </View>

                // <Input
                //   placeholder="e.g. blm.id"
                //   value={serverHost}
                //   onChangeText={setServerHost}
                //   autoCapitalize="none"
                //   style={{ marginTop: 8 }}
                // />
              )}
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.label}>LICENSE PORT</Text>
              <View style={styles.inputWithSwitchContainer}>
                <TextInput
                  style={[
                    styles.portInput,
                    !isPortEnabled && { opacity: 0.5, backgroundColor: '#111' },
                  ]}
                  placeholder="3001"
                  placeholderTextColor="#555"
                  value={serverPort}
                  onChangeText={setServerPort}
                  keyboardType="numeric"
                  editable={isPortEnabled}
                />
                <View style={styles.switchOverlay}>
                  <Switch
                    value={isPortEnabled}
                    onValueChange={setIsPortEnabled}
                    trackColor={{ false: '#333', true: '#4d5d30' }}
                    thumbColor={isPortEnabled ? '#a6c455' : '#666'}
                    ios_backgroundColor="#333"
                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                  />
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={styles.saveServerButton}
              onPress={handleSaveServerSettings}
              activeOpacity={0.8}>
              <MaterialCommunityIcons name="content-save" size={18} color="#fff" />
              <Text style={styles.saveServerButtonText}>SAVE CONFIGURATION</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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

            {/* License Key Input */}
            <View style={styles.fieldContainer}>
              <Text style={styles.label}>LICENSE KEY</Text>
              <Input
                placeholder="Enter license key"
                value={licenseKey}
                onChangeText={handleLicenseKeyChange}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={19}
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
                  statusMessage.type === 'success' && { color: '#a6c455' },
                  statusMessage.type === 'warning' && { color: '#ff8800' },
                  statusMessage.type === 'error' && { color: '#ff4444' },
                ]}>{statusMessage.title}</Text>
                <Text style={styles.statusMessage}>{statusMessage.message}</Text>
              </View>
            )}

            {/* Buttons */}
            <View style={styles.buttonRow}>
              <View style={{ flex: 1 }}>
                <Button
                  title="CHECK KEY"
                  onPress={handleCheckKey}
                  isLoading={isChecking}
                  variant="outline"
                />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
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
  settingsGearButton: {
    position: 'absolute',
    top: 50,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: '#4d5d30',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  serverSettingsDropdown: {
    position: 'absolute',
    top: 100,
    right: 16,
    left: 16,
    zIndex: 99,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4d5d30',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  serverSettingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  serverSettingsTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 1,
    marginLeft: 10,
  },
  serverSettingsContent: {
    padding: 16,
  },
  serverSettingsInfo: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  saveServerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4d5d30',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#5a6b38',
    marginTop: 8,
    gap: 8,
  },
  saveServerButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  quickSelectContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#222',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
    marginTop: 8,
  },
  dropdownTriggerText: {
    color: '#fff',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxHeight: '50%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  quickSelectSiteButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#262626',
  },
  quickSelectSiteButtonActive: {
    backgroundColor: '#4d5d30',
    borderColor: '#a6c455',
    borderWidth: 1,
  },
  quickSelectSiteButtonText: {
    color: '#eee',
    fontSize: 16,
    fontWeight: '600',
  },
  ipSubtext: {
    color: '#666',
    fontSize: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
    backgroundColor: '#555',
  },
  statusDotOnline: {
    backgroundColor: '#4caf50',
  },
  statusDotOffline: {
    backgroundColor: '#f44336',
  },
  statusDotChecking: {
    backgroundColor: '#ff9800',
  },
  statusText: {
    color: '#666',
    fontSize: 11,
  },
  statusTextOnline: {
    color: '#4caf50',
  },
  statusTextOffline: {
    color: '#f44336',
  },
  quickSelectButtonTextActive: {
    color: '#fff',
  },
  inputWithSwitchContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  portInput: {
    backgroundColor: '#222',
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
    paddingRight: 60,
  },
  quickSelectButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 4,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#444',
  },
  quickSelectButtonActive: {
    backgroundColor: '#4d5d30',
    borderColor: '#a6c455',
  },
  quickSelectButtonText: {
    color: '#999',
    fontSize: 11,
    fontWeight: '600',
  },
  switchOverlay: {
    position: 'absolute',
    right: 8,
    height: '100%',
    justifyContent: 'center',
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
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 8,
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
  customSiteContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 4,
    marginBottom: 8,
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
