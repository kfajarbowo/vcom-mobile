import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';
import { apiRequest } from '../../services/apiClient';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

type Step = 'callsign' | 'otp' | 'newPassword';

export function ForgotPasswordScreen({ navigation }: Props) {
  const [step, setStep] = useState<Step>('callsign');
  const [callsign, setCallsign] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRequestReset = async () => {
    if (!callsign.trim()) {
      Alert.alert('Error', 'Please enter your callsign.');
      return;
    }
    setIsLoading(true);
    try {
      await apiRequest('/api/auth/request-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callsign: callsign.trim() }),
      });
      setStep('otp');
      Alert.alert('Code Sent', 'If your callsign exists, a reset code has been sent via push notification.');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to request reset.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) {
      Alert.alert('Error', 'Please enter the 6-digit code.');
      return;
    }
    setIsLoading(true);
    try {
      const result = await apiRequest('/api/auth/verify-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callsign: callsign.trim(), otp }),
      });
      setTempToken(result.tempToken);
      setStep('newPassword');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Invalid or expired code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }
    setIsLoading(true);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken, newPassword }),
      });
      Alert.alert('Success', 'Your password has been reset. Please login.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to reset password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#a6c455" />
        </TouchableOpacity>
        <Text style={styles.title}>RESET PASSWORD</Text>
      </View>

      <View style={styles.form}>
        {step === 'callsign' && (
          <>
            <Text style={styles.label}>CALLSIGN</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your callsign"
              placeholderTextColor="#666"
              value={callsign}
              onChangeText={setCallsign}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleRequestReset}
              disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator color="#1a1a1a" />
              ) : (
                <Text style={styles.buttonText}>SEND RESET CODE</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {step === 'otp' && (
          <>
            <Text style={styles.label}>ENTER 6-DIGIT CODE</Text>
            <Text style={styles.subtitle}>
              Check your Gotify notifications for the reset code.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="000000"
              placeholderTextColor="#666"
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
            />
            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleVerifyOtp}
              disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator color="#1a1a1a" />
              ) : (
                <Text style={styles.buttonText}>VERIFY CODE</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {step === 'newPassword' && (
          <>
            <Text style={styles.label}>NEW PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter new password"
              placeholderTextColor="#666"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />
            <Text style={styles.label}>CONFIRM PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor="#666"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleResetPassword}
              disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator color="#1a1a1a" />
              ) : (
                <Text style={styles.buttonText}>RESET PASSWORD</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backButton: {
    marginRight: 16,
  },
  title: {
    color: '#a6c455',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  form: {
    padding: 24,
  },
  label: {
    color: '#a6c455',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
  },
  subtitle: {
    color: '#888',
    fontSize: 13,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    borderWidth: 1,
    borderColor: '#4d5d30',
    borderRadius: 4,
    padding: 14,
    fontSize: 16,
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#a6c455',
    borderRadius: 4,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#1a1a1a',
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 1,
  },
});
