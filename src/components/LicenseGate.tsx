import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLicenseStore } from '../store/licenseStore';
import { LicenseActivationScreen } from '../screens/LicenseActivationScreen';

interface LicenseGateProps {
  children: React.ReactNode;
}

/**
 * LicenseGate - Conditional rendering wrapper for license verification
 *
 * Blocks entire app access until valid license is activated.
 * Shows loading screen while checking license status.
 * Shows activation screen if no valid license found.
 * Renders children (app content) if license is valid.
 *
 * TESTING MODE: Currently disabled - bypasses license check
 */
export function LicenseGate({ children }: LicenseGateProps) {
  const { isLicenseValid, isLoading, hasCheckedLicense } = useLicenseStore();

  // Show loading screen while checking license
  if (isLoading || !hasCheckedLicense) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8d9c6b" />
        <Text style={styles.loadingText}>VERIFYING LICENSE...</Text>
      </View>
    );
  }

  // Show activation screen if no valid license
  if (!isLicenseValid) {
    return <LicenseActivationScreen />;
  }

  // Render app content if license is valid
  return <>{children}</>;

}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#171717',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 12,
    color: '#999',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
