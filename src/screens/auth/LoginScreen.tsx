import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { Input, Button } from '../../components/ui';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../store/authStore';
import { setApiServer, STORAGE_KEYS, apiClient } from '../../services/apiClient';
import { clearLicenseKey } from '../../services/licenseService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';

const loginSchema = z.object({
  callsign: z.string().min(1, 'Callsign is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverHost, setServerHost] = useState('192.168.100.7');
  const [serverPort, setServerPort] = useState('5000');
  const { setUser, setSessionToken } = useAuthStore();

  // Load saved server settings on mount
  useEffect(() => {
    loadServerSettings();
  }, []);

  const loadServerSettings = async () => {
    try {
      const savedHost = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_HOST);
      const savedPort = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PORT);

      if (savedHost) setServerHost(savedHost);
      if (savedPort) setServerPort(savedPort);

      console.log('[Login] Loaded server settings:', { host: savedHost, port: savedPort });
    } catch (error) {
      console.error('[Login] Error loading server settings:', error);
    }
  };

  const handleServerSettingsSave = async () => {
    try {
      await setApiServer(serverHost, serverPort);
      Alert.alert('Success', `Server set to ${serverHost}:${serverPort}`, [{ text: 'OK' }]);
      setShowServerSettings(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to save server settings');
    }
  };

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      callsign: '',
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
      setIsLoading(true);

      console.log('[Login] Attempting login for:', data.callsign);
      const response = await authService.login(data);

      // Update auth store
      setUser(response.user);
      await setSessionToken(response.sessionToken);

      console.log('[Login] Success:', response.user.callsign);
      console.log('[Login] Session token saved');

      // Connect to WebSocket now that we're authenticated (pass user ID directly)
      const { websocketService } = await import('../../services/websocket');
      websocketService.connect(response.user.id).catch((error) => {
        console.error('[Login] WebSocket connection error:', error);
      });
      console.log('[Login] WebSocket connection initiated with userId:', response.user.id);

      // Auto-fetch and configure Gotify push notifications
      fetchAndConfigureGotify().catch((error) => {
        console.error('[Login] Gotify configuration error:', error);
        // Non-critical, continue with login
      });
    } catch (error) {
      console.error('[Login] Error:', error);

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('[Login] Error message:', errorMessage);

      // Parse common error messages for better UX
      let suggestions: string[] = [];

      if (errorMessage.includes('Invalid credentials') || errorMessage.includes('Unauthorized')) {
        suggestions.push('Check your callsign and password');
        suggestions.push('Callsign is case-sensitive');
      } else if (errorMessage.includes('Network') || errorMessage.includes('fetch')) {
        suggestions.push('Check your WiFi connection');
        suggestions.push(`Verify server is running at ${serverHost}:${serverPort}`);
        suggestions.push('Tap SERVER SETTINGS above to configure');
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
      setIsLoading(false);
    }
  };

  const fetchAndConfigureGotify = async () => {
    try {
      console.log('[Login] Fetching Gotify configuration...');

      // Get session token
      const sessionToken = await AsyncStorage.getItem(STORAGE_KEYS.SESSION_TOKEN);

      // Fetch token from backend using plain fetch
      const response = await fetch(`http://${serverHost}:${serverPort}/api/user/gotify-token/full`, {
        headers: {
          'X-Session-Token': sessionToken || '',
        },
      });

      if (!response.ok) {
        console.warn('[Login] Failed to fetch Gotify token:', response.status);
        return;
      }

      const data = await response.json();

      if (data && data.clientToken) {
        const token = data.clientToken;
        console.log('[Login] Gotify token received');

        // Store Gotify configuration in AsyncStorage
        await AsyncStorage.setItem('@gotify_url', `http://${serverHost}:8080`);
        await AsyncStorage.setItem('@gotify_client_token', token);
        await AsyncStorage.setItem('@gotify_service_enabled', 'true');

        console.log('[Login] Gotify configuration saved to AsyncStorage');

        // Start Gotify foreground service
        const { callNotificationService } = await import('../../services/callNotificationService');
        await callNotificationService.initialize();

        console.log('[Login] Gotify service initialized');
      } else {
        console.warn('[Login] No Gotify token available from backend');
      }
    } catch (error) {
      console.error('[Login] Failed to fetch/configure Gotify:', error);
      // Non-critical error, don't block login
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Server Settings Gear Button - Top Right */}
      <TouchableOpacity
        style={styles.settingsGearButton}
        onPress={() => setShowServerSettings(!showServerSettings)}
        activeOpacity={0.7}>
        <MaterialCommunityIcons
          name="cog"
          size={24}
          color="#a6c455"
        />
      </TouchableOpacity>

      {/* Server Settings Dropdown */}
      {showServerSettings && (
        <View style={styles.serverSettingsDropdown}>
          <View style={styles.serverSettingsHeader}>
            <MaterialCommunityIcons name="server-network" size={20} color="#a6c455" />
            <Text style={styles.serverSettingsTitle}>SERVER SETTINGS</Text>
            <TouchableOpacity onPress={() => setShowServerSettings(false)}>
              <MaterialCommunityIcons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          <View style={styles.serverSettingsContent}>
            <Text style={styles.serverSettingsInfo}>
              Configure the local WiFi server address
            </Text>

            <View style={styles.fieldContainer}>
              <Text style={styles.label}>SERVER HOST / IP ADDRESS</Text>
              <Input
                placeholder="192.168.x.x"
                value={serverHost}
                onChangeText={setServerHost}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.label}>SERVER PORT</Text>
              <Input
                placeholder="5000"
                value={serverPort}
                onChangeText={setServerPort}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
              />
            </View>

            <TouchableOpacity
              style={styles.saveServerButton}
              onPress={handleServerSettingsSave}
              activeOpacity={0.8}>
              <MaterialCommunityIcons
                name="content-save"
                size={20}
                color="#ffffff"
              />
              <Text style={styles.saveServerButtonText}>SAVE SERVER SETTINGS</Text>
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
              name="callsign"
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={styles.fieldContainer}>
                  <Text style={styles.label}>CALLSIGN / USERNAME</Text>
                  <Input
                    placeholder="ENTER CALLSIGN"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.callsign?.message}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  {errors.callsign && (
                    <Text style={styles.errorText}>{errors.callsign.message}</Text>
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
                  <Input
                    placeholder="ENTER SECURITY CODE"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.password?.message}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  {errors.password && (
                    <Text style={styles.errorText}>{errors.password.message}</Text>
                  )}
                </View>
              )}
            />

            <Text style={styles.disclaimer}>
              AUTHORIZED PERSONNEL ONLY
            </Text>

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
});
