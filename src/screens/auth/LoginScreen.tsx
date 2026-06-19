import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, StyleSheet, TouchableOpacity, Switch, TextInput, Modal, FlatList, ActivityIndicator } from 'react-native';
import { fetchCustomSites, checkAllSitesStatus, Site } from '../../services/siteService';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { Input, Button } from '../../components/ui';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../store/authStore';
import { setApiServer, getApiBaseUrl, STORAGE_KEYS } from '../../services/apiClient';
import { clearLicenseKey } from '../../services/licenseService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';

const loginSchema = z.object({
  nrp: z.string().min(1, 'NRP/Personnel ID is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { setUser, setSessionToken } = useAuthStore();

  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverHost, setServerHost] = useState('chat.id');
  const [serverPort, setServerPort] = useState('5000');
  const [isPortEnabled, setIsPortEnabled] = useState(false);
  const [isModalVisible, setModalVisible] = useState(false);
  const [customSites, setCustomSites] = useState<Site[]>([]);
  const [siteStatuses, setSiteStatuses] = useState<Record<string, boolean | null>>({});
  const [isLoadingSites, setIsLoadingSites] = useState(false);

  useEffect(() => {
    const loadServerSettings = async () => {
      try {
        const host = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_HOST);
        const port = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PORT);
        if (host) setServerHost(host);
        if (port) setServerPort(port);
      } catch (error) {
        console.error('[Login] Failed to load server settings:', error);
      }
    };
    loadServerSettings();
  }, []);

  // Fetch sites when settings are opened
  useEffect(() => {
    if (showServerSettings && customSites.length === 0) {
      const loadSites = async () => {
        setIsLoadingSites(true);
        const sites = await fetchCustomSites();
        if (sites.length === 0) {
          Alert.alert('Connection Note', 'Could not retrieve site list. Please check your connection or try again.');
        }
        setCustomSites(sites);

        // Check connectivity for all sites in parallel
        setSiteStatuses(Object.fromEntries(sites.map(s => [s.ip, null])));
        const statuses = await checkAllSitesStatus(sites, parseInt(serverPort) || 5000);
        setSiteStatuses(statuses);

        // Auto-deselect if the currently selected site is offline
        if (statuses[serverHost] === false) {
          Alert.alert('Site Offline', `${serverHost} is unreachable. Reverting to default.`);
          setServerHost('chat.id');
        }

        setIsLoadingSites(false);
      };
      loadSites();
    }
  }, [showServerSettings, customSites.length]);

  const handleSaveServerSettings = async () => {
    try {
      await setApiServer(serverHost, serverPort);
      setShowServerSettings(false);
      Alert.alert('Success', 'Server settings saved globally.');
    } catch (error) {
      Alert.alert('Error', 'Failed to save server settings.');
    }
  };

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      nrp: '',
      password: '',
    },
  });

  const handleClearLicense = async () => {
    Alert.alert(
      'Clear License Key',
      'This will erase the license key and require re-activation on next app restart. This is for testing only.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearLicenseKey();
              Alert.alert('Success', 'License key cleared. Restart the app to see activation screen.', [{ text: 'OK' }]);
            } catch (error) {
              Alert.alert('Error', 'Failed to clear license key', [{ text: 'OK' }]);
            }
          },
        },
      ]
    );
  };

  const onSubmit = async (data: LoginForm) => {
    try {
      console.log('[Login] 1. onSubmit started');
      setIsLoading(true);

      console.log('[Login] 2. Attempting login for NRP:', data.nrp);
      const response = await authService.login(data);
      console.log('[Login] 3. Login API success:', response.user.callsign);

      // Update auth store
      console.log('[Login] 4. Updating user in store');
      setUser(response.user);

      console.log('[Login] 5. Saving session token');
      await setSessionToken(response.sessionToken);
      console.log('[Login] 6. Session token saved');

      // Connect to WebSocket now that we're authenticated (pass user ID directly)
      console.log('[Login] 7. Initiating WebSocket connection');
      const { websocketService } = await import('../../services/websocket');

      // We don't await this, but we catch errors
      websocketService.connect(response.user.id).catch((error) => {
        console.error('[Login] WebSocket connection error:', error);
      });
      console.log('[Login] 8. WebSocket connection initiated with userId:', response.user.id);

      // NOTE: Background service disabled - it creates a second WebSocket connection
      // which interferes with the JS WebSocket. The server sends messages to only one
      // connection, causing realtime updates to fail.
      // TODO: Only start background service when app goes to background state
      // console.log('[Login] 9. Starting background service');
      // startBackgroundService(response.user.id).catch((error) => {
      //   console.error('[Login] Background service error:', error);
      // });
      // console.log('[Login] 10. Background service start initiated');

    } catch (error) {
      console.error('[Login] Error caught in onSubmit:', error);

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('[Login] Error message:', errorMessage);

      // Parse common error messages for better UX
      let suggestions: string[] = [];

      if (errorMessage.includes('Invalid credentials') || errorMessage.includes('Unauthorized')) {
        suggestions.push('Check your NRP and password');
        suggestions.push('NRP is case-sensitive');
      } else if (errorMessage.includes('Network') || errorMessage.includes('fetch')) {
        suggestions.push('Check your connection');
        suggestions.push(`Verify server at ${serverHost} is reachable`);
      } else if (errorMessage.includes('No session token')) {
        suggestions.push('Server authentication error');
        suggestions.push('Contact system administrator');
      }

      Alert.alert(
        'Login Failed',
        errorMessage + (suggestions.length > 0 ? '\n\nSuggestions:\n• ' + suggestions.join('\n• ') : ''),
        [{ text: 'OK' }]
      );
    } finally {
      console.log('[Login] 11. Finally block - stopping loading');
      setIsLoading(false);
    }
  };


  const startBackgroundService = async (userId: number) => {
    try {
      console.log('[Login] Configuring background service...');

      // Construct WebSocket URL dynamically
      const baseUrl = await getApiBaseUrl();
      const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';

      console.log('[Login] Background service URL:', wsUrl);
      console.log('[Login] Background service UserId:', userId);

      // Import service dynamically
      const { callNotificationService } = await import('../../services/callNotificationService');

      // Configure and start
      // We pass userId as string, the service handles it
      await callNotificationService.configureBackgroundService(wsUrl, String(userId));

      console.log('[Login] Background service started successfully');
    } catch (error) {
      console.error('[Login] Failed to start background service:', error);
    }
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
              Configure internal network address
            </Text>
            <View style={styles.fieldContainer}>
              <Text style={styles.label}>HOST ADDRESS</Text>
              <View style={styles.quickSelectContainer}>
                {['chat.id'].map((domain) => (
                  <TouchableOpacity
                    key={domain}
                    style={[styles.quickSelectButton, serverHost === domain && styles.quickSelectButtonActive]}
                    onPress={() => {
                      setServerHost(domain);
                      setServerPort('5000');
                    }}>
                    <Text style={[styles.quickSelectButtonText, serverHost === domain && styles.quickSelectButtonTextActive]}>
                      {domain}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[styles.quickSelectButton, serverHost !== 'chat.id' && styles.quickSelectButtonActive]}
                  onPress={() => setServerHost('')}>
                  <Text style={[styles.quickSelectButtonText, serverHost !== 'chat.id' && styles.quickSelectButtonTextActive]}>
                    Custom
                  </Text>
                </TouchableOpacity>
              </View>

              {(serverHost !== 'chat.id') && (
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
                                  const sites = await fetchCustomSites();
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
                                // Prefer the chatIp for login
                                setServerHost(item.ip);
                                setServerPort('5000');
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
              )}
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.label}>PORT</Text>
              <View style={styles.inputWithSwitchContainer}>
                <TextInput
                  style={[
                    styles.portInput,
                    !isPortEnabled && { opacity: 0.5, backgroundColor: '#111' }
                  ]}
                  placeholder="5000"
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
            <Text style={styles.title}>
              VCOMM MOBILE
            </Text>
            <Text style={styles.subtitle}>
              SECURE MILITARY COMMUNICATION SYSTEM
            </Text>
            <View style={styles.divider} />
          </View>

          <View style={styles.formContainer}>
            <Controller
              control={control}
              name="nrp"
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={styles.fieldContainer}>
                  <Text style={styles.label}>NRP / PERSONNEL ID</Text>
                  <Input
                    placeholder="ENTER NRP"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.nrp?.message}
                    autoCapitalize="none"
                    keyboardType="numeric"
                    autoCorrect={false}
                  />
                  {errors.nrp && (
                    <Text style={styles.errorText}>{errors.nrp.message}</Text>
                  )}
                </View>
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={styles.fieldContainer}>
                  <Text style={styles.label}>SECURITY CODE / PASSWORD</Text>
                  <View style={styles.passwordWrapper}>
                    <Input
                      placeholder="ENTER SECURITY CODE"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.password?.message}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      style={styles.passwordInput}
                    />
                    <TouchableOpacity
                      style={styles.eyeButton}
                      onPress={() => setShowPassword(prev => !prev)}
                      activeOpacity={0.7}>
                      <MaterialCommunityIcons
                        name={showPassword ? 'eye-off' : 'eye'}
                        size={20}
                        color="#a6c455"
                      />
                    </TouchableOpacity>
                  </View>

                  {errors.password && (
                    <Text style={styles.errorText}>{errors.password.message}</Text>
                  )}
                </View>
              )}
            />

            <View style={styles.buttonContainer}>
              <Button
                title="AUTHENTICATE"
                onPress={handleSubmit(onSubmit)}
                isLoading={isLoading}
              />
            </View>



            <View style={styles.buttonContainer}>
              <Button
                title="REGISTER PERSONNEL"
                variant="outline"
                onPress={() => navigation.navigate('Register')}
                disabled={isLoading}
              />
            </View>

            <Text style={styles.footerText}>
              ⚠ INTRANET COMMUNICATIONS ONLY - CLASSIFIED
            </Text>

            <Text style={styles.disclaimer}>
              AUTHORIZED PERSONNEL ONLY
            </Text>

            {/* Testing Only - Clear License Key */}
            <TouchableOpacity
              style={styles.clearLicenseButton}
              onPress={handleClearLicense}
              activeOpacity={0.7}>
              <Text style={styles.clearLicenseText}>
                [TEST] Clear License Key
              </Text>
            </TouchableOpacity>
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
  disclaimer: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  buttonContainer: {
    marginTop: 12,
  },
  passwordWrapper: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 36,
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  forgotPasswordText: {
    color: '#a6c455',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
  footerText: {
    fontSize: 9,
    color: '#a6c455',
    textAlign: 'center',
    marginTop: 32,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  clearLicenseButton: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'center',
  },
  clearLicenseText: {
    fontSize: 9,
    color: '#666',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  settingsGearButton: {
    position: 'absolute',
    top: 16,
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
    top: 70,
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
  quickSelectButtonTextActive: {
    color: '#fff',
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
    fontSize: 14,
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
  switchOverlay: {
    position: 'absolute',
    right: 8,
    height: '100%',
    justifyContent: 'center',
  },
});
