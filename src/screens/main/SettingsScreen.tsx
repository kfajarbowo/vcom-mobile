import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator, Switch, TextInput, Modal, FlatList } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuthStore } from '../../store/authStore';
import { Input } from '../../components/ui';
import { setApiServer, STORAGE_KEYS, apiRequest } from '../../services/apiClient';
import { useLicenseStore } from '../../store/licenseStore';
import { getDeviceHardwareId } from '../../services/licenseService';
import { fetchCustomSites, checkAllSitesStatus, Site } from '../../services/siteService';

export function SettingsScreen() {
  const { user, logout } = useAuthStore();

  // Change password state
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

  // Gotify settings state
  // const [gotifyUrl, _setGotifyUrl] = useState('');
  // const [gotifyToken, _setGotifyToken] = useState('');
  // const [isEditingGotify, _setIsEditingGotify] = useState(false);
  // const [gotifyServiceEnabled, _setGotifyServiceEnabled] = useState(false);
  // const [isLoadingGotify, _setIsLoadingGotify] = useState(false);

  // License info
  const { licenseKey } = useLicenseStore();
  const [hardwareId, setHardwareId] = useState<string>('');

  useEffect(() => {
    const fetchHardwareId = async () => {
      try {
        const id = await getDeviceHardwareId();
        setHardwareId(id);
      } catch (error) {
        console.error('Failed to fetch hardware ID:', error);
      }
    };
    fetchHardwareId();
  }, []);

  const [serverHost, setServerHost] = useState('chat.id');
  const [serverPort, setServerPort] = useState('5000');
  const [isPortEnabled, setIsPortEnabled] = useState(false);
  const [isEditingServer, setIsEditingServer] = useState(false);
  const [isModalVisible, setModalVisible] = useState(false);
  const [customSites, setCustomSites] = useState<Site[]>([]);
  const [siteStatuses, setSiteStatuses] = useState<Record<string, boolean | null>>({});
  const [isLoadingSites, setIsLoadingSites] = useState(false);

  useEffect(() => {
    const fetchServerConfig = async () => {
      try {
        const host = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_HOST);
        const port = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PORT);
        if (host) {setServerHost(host);}
        if (port) {setServerPort(port);}
      } catch (error) {
        console.error('Failed to load server config:', error);
      }
    };
    fetchServerConfig();
  }, []);

  // Fetch sites when editing is enabled
  useEffect(() => {
    if (isEditingServer && customSites.length === 0) {
      const loadSites = async () => {
        setIsLoadingSites(true);
        const sites = await fetchCustomSites();
        if (sites.length === 0) {
          Alert.alert('Connection Note', 'Could not retrieve site list. Please check your connection or try again.');
        }
        setCustomSites(sites);

        // Check connectivity for all sites in parallel
        setSiteStatuses(Object.fromEntries(sites.map(s => [s.ip, null]))); // null = checking
        const statuses = await checkAllSitesStatus(sites, parseInt(serverPort, 10) || 5000);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditingServer, customSites.length]);

  const handleSaveServer = async () => {
    try {
      const prevHost = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_HOST);
      const prevPort = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_PORT);
      const hostChanged = prevHost !== serverHost;
      const portChanged = isPortEnabled ? prevPort !== serverPort : false;

      await setApiServer(serverHost, serverPort);
      setIsEditingServer(false);

      if (hostChanged || portChanged) {
        Alert.alert(
          'Server Changed',
          'Server configuration updated. You will be logged out.',
          [{ text: 'OK', onPress: () => logout() }],
        );
      } else {
        Alert.alert('Success', 'Server configuration saved.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to save server configuration.');
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword.trim()) {
      Alert.alert('Error', 'Please enter your current password.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      Alert.alert('Error', 'New passwords do not match.');
      return;
    }
    setIsPasswordLoading(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      Alert.alert('Success', 'Password changed successfully.');
      setIsChangingPassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to change password.');
    } finally {
      setIsPasswordLoading(false);
    }
  };

  const handleCancelPasswordChange = () => {
    setIsChangingPassword(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CONFIGURATION</Text>
        <View style={styles.headerDivider} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* User Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>OPERATOR INFO</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>CALLSIGN</Text>
              <Text style={styles.infoValue}>
                {user?.callsign?.toUpperCase() || 'N/A'}
              </Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>NAME</Text>
              <Text style={styles.infoValue}>
                {user?.fullName?.toUpperCase() || 'N/A'}
              </Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>NRP</Text>
              <Text style={styles.infoValue}>
                {user?.nrp || 'N/A'}
              </Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>ROLE</Text>
              <Text style={styles.infoValue}>
                {user?.role?.toUpperCase() || 'N/A'}
              </Text>
            </View>

            <View style={styles.infoDivider} />

            {!isChangingPassword ? (
              <TouchableOpacity
                style={styles.changePasswordButton}
                onPress={() => setIsChangingPassword(true)}
                activeOpacity={0.7}>
                <MaterialCommunityIcons name="lock-reset" size={18} color="#a6c455" />
                <Text style={styles.changePasswordButtonText}>CHANGE PASSWORD</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.changePasswordForm}>
                <Text style={styles.changePasswordTitle}>CHANGE PASSWORD</Text>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>CURRENT PASSWORD</Text>
                  <Input
                    placeholder="Enter current password"
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>NEW PASSWORD</Text>
                  <Input
                    placeholder="Enter new password"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>CONFIRM NEW PASSWORD</Text>
                  <Input
                    placeholder="Confirm new password"
                    value={confirmNewPassword}
                    onChangeText={setConfirmNewPassword}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.saveButton, isPasswordLoading && { opacity: 0.6 }]}
                    onPress={handleChangePassword}
                    disabled={isPasswordLoading}
                    activeOpacity={0.8}>
                    {isPasswordLoading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="check" size={18} color="#ffffff" />
                        <Text style={styles.saveButtonText}>CONFIRM</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={handleCancelPasswordChange}
                    disabled={isPasswordLoading}
                    activeOpacity={0.8}>
                    <MaterialCommunityIcons name="close" size={18} color="#999" />
                    <Text style={styles.cancelButtonText}>CANCEL</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* License Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>LICENSE INFORMATION</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>LICENSE KEY</Text>
              <Text style={[styles.infoValue, { color: licenseKey ? '#a6c455' : '#d97070' }]}>
                {licenseKey || 'NOT ACTIVATED'}
              </Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>HARDWARE ID</Text>
              <Text style={[styles.infoValue, { fontSize: 10 }]}>
                {hardwareId || 'FETCHING...'}
              </Text>
            </View>
          </View>
        </View>

        {/* Server Settings */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>SERVER CONFIGURATION</Text>
            {!isEditingServer && (
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => setIsEditingServer(true)}
                activeOpacity={0.7}>
                <MaterialCommunityIcons name="pencil" size={12} color="#a6c455" />
                <Text style={styles.editButtonText}>EDIT</Text>
              </TouchableOpacity>
            )}
          </View>

          {!isEditingServer ? (
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>HOST / IP</Text>
                <Text style={styles.infoValue}>{serverHost}</Text>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>PORT</Text>
                <Text style={styles.infoValue}>{serverPort}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.editCard}>
              <Text style={styles.editInfo}>
                Configure internal network address
              </Text>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>HOST ADDRESS</Text>
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

                {serverHost !== 'chat.id' && serverHost !== '172.20.10.5' && (
                  <View>
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

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>PORT</Text>
                <View style={styles.inputWithSwitchContainer}>
                  <TextInput
                    style={[
                      styles.portInput,
                      !isPortEnabled && { opacity: 0.5, backgroundColor: '#111' },
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
                      trackColor={{ false: '#222', true: '#4d5d30' }}
                      thumbColor={isPortEnabled ? '#a6c455' : '#666'}
                      ios_backgroundColor="#222"
                      style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                    />
                  </View>
                </View>
              </View>

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={handleSaveServer}
                  activeOpacity={0.8}>
                  <MaterialCommunityIcons name="check" size={18} color="#ffffff" />
                  <Text style={styles.saveButtonText}>CONFIRM</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setIsEditingServer(false)}
                  activeOpacity={0.8}>
                  <MaterialCommunityIcons name="close" size={18} color="#999" />
                  <Text style={styles.cancelButtonText}>CANCEL</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
        {/* Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SYSTEM ACTIONS</Text>
          <TouchableOpacity style={styles.logoutButton} onPress={logout}>
            <MaterialCommunityIcons name="logout" size={22} color="#d97070" style={styles.logoutIcon} />
            <Text style={styles.logoutText}>TERMINATE SESSION</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#171717',
  },
  header: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#4d5d30',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 2,
    textAlign: 'center',
  },
  headerDivider: {
    height: 2,
    backgroundColor: '#4d5d30',
    width: 80,
    alignSelf: 'center',
    marginTop: 8,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#888',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  infoCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#4d5d30',
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoDivider: {
    height: 1,
    backgroundColor: '#2a2a2a',
    marginVertical: 4,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#666',
    letterSpacing: 1,
  },
  infoValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 0.5,
  },
  logoutButton: {
    backgroundColor: '#4d2020',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#6b3030',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutIcon: {
    marginRight: 12,
  },
  logoutText: {
    color: '#d97070',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4d5d30',
  },
  editButtonText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 0.5,
  },
  editCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#4d5d30',
    padding: 16,
  },
  editInfo: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 8,
    letterSpacing: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4d5d30',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#5a6b38',
    gap: 8,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  cancelButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#2a2a2a',
    gap: 8,
  },
  cancelButtonText: {
    color: '#999',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  changePasswordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
    marginTop: 4,
  },
  changePasswordButtonText: {
    color: '#a6c455',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  changePasswordForm: {
    marginTop: 8,
  },
  changePasswordTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
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
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
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
  inputWithSwitchContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  portInput: {
    backgroundColor: '#111',
    borderColor: '#333',
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
  dropdownTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#111',
    padding: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#333',
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
});
