import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {useAuthStore} from '../../store/authStore';

export function SettingsScreen() {
  const {user, logout} = useAuthStore();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CONFIGURATION</Text>
        <View style={styles.headerDivider} />
      </View>

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

      {/* Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>SYSTEM ACTIONS</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutIcon}>⏻</Text>
          <Text style={styles.logoutText}>TERMINATE SESSION</Text>
        </TouchableOpacity>
      </View>
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
});
