import React, {useState, useEffect} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAuthStore} from '../../store/authStore';
import {Input} from '../../components/ui';
import {setApiServer, STORAGE_KEYS} from '../../services/apiClient';

export function SettingsScreen() {
  const {user, logout} = useAuthStore();
  const [serverHost, setServerHost] = useState('192.168.100.7');
  const [serverPort, setServerPort] = useState('5000');
  const [isEditing, setIsEditing] = useState(false);

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

      console.log('[Settings] Loaded server settings:', {host: savedHost, port: savedPort});
    } catch (error) {
      console.error('[Settings] Error loading server settings:', error);
    }
  };

  const handleServerSettingsSave = async () => {
    try {
      await setApiServer(serverHost, serverPort);
      Alert.alert(
        'Server Settings Updated',
        `Server configured to ${serverHost}:${serverPort}\n\nChanges will take effect on next app restart.`,
        [{text: 'OK'}]
      );
      setIsEditing(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to save server settings', [{text: 'OK'}]);
    }
  };

  const handleCancelEdit = async () => {
    // Reload original settings
    await loadServerSettings();
    setIsEditing(false);
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
            <Text style={styles.infoLabel}>ROLE</Text>
            <Text style={styles.infoValue}>
              {user?.role?.toUpperCase() || 'N/A'}
            </Text>
          </View>
        </View>
      </View>

      {/* Server Settings */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>SERVER SETTINGS</Text>
          {!isEditing && (
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => setIsEditing(true)}
              activeOpacity={0.7}>
              <MaterialCommunityIcons name="pencil" size={16} color="#a6c455" />
              <Text style={styles.editButtonText}>EDIT</Text>
            </TouchableOpacity>
          )}
        </View>

        {!isEditing ? (
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>SERVER HOST</Text>
              <Text style={styles.infoValue}>{serverHost}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>SERVER PORT</Text>
              <Text style={styles.infoValue}>{serverPort}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>BASE URL</Text>
              <Text style={styles.infoValue}>http://{serverHost}:{serverPort}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.editCard}>
            <Text style={styles.editInfo}>
              Configure the local WiFi server address for API communication
            </Text>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>SERVER HOST / IP ADDRESS</Text>
              <Input
                placeholder="192.168.x.x"
                value={serverHost}
                onChangeText={setServerHost}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>SERVER PORT</Text>
              <Input
                placeholder="5000"
                value={serverPort}
                onChangeText={setServerPort}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleServerSettingsSave}
                activeOpacity={0.8}>
                <MaterialCommunityIcons name="content-save" size={18} color="#ffffff" />
                <Text style={styles.saveButtonText}>SAVE</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancelEdit}
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
            <Text style={styles.logoutIcon}>⏻</Text>
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
    fontSize: 20,
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
});
