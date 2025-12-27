import React from 'react';
import {View, TextInput, Text, type TextInputProps, StyleSheet} from 'react-native';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({label, error, style, ...props}: InputProps) {
  return (
    <View style={{width: '100%'}}>
      {label && (
        <Text style={styles.label}>{label}</Text>
      )}
      <TextInput
        style={[styles.input, error && styles.inputError, style]}
        placeholderTextColor="#555"
        {...props}
      />
      {error && (
        <Text style={styles.error}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: '#999',
    fontWeight: '600',
    marginBottom: 8,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#222',
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
  },
  inputError: {
    borderColor: '#ff4444',
  },
  error: {
    color: '#ff4444',
    fontSize: 11,
    marginTop: 4,
    letterSpacing: 0.3,
  },
});
