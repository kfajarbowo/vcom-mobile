import React from 'react';
import {
  Pressable,
  Text,
  ActivityIndicator,
  StyleSheet,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

interface ButtonProps extends PressableProps {
  title: string;
  variant?: 'default' | 'destructive' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  isLoading?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  variant = 'default',
  size = 'default',
  isLoading = false,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || isLoading;

  const variantStyle = {
    default: styles.defaultVariant,
    destructive: styles.destructiveVariant,
    outline: styles.outlineVariant,
    ghost: styles.ghostVariant,
  }[variant];

  const sizeStyle = {
    default: styles.defaultSize,
    sm: styles.smSize,
    lg: styles.lgSize,
  }[size];

  const textColor = {
    default: '#fff',
    destructive: '#fff',
    outline: '#fff',
    ghost: '#fff',
  }[variant];

  return (
    <Pressable
      style={[
        styles.base,
        variantStyle,
        sizeStyle,
        isDisabled && styles.disabled,
        style,
      ]}
      disabled={isDisabled}
      {...props}>
      {isLoading ? (
        <ActivityIndicator color={variant === 'outline' ? '#a6c455' : '#fff'} />
      ) : (
        <Text style={[styles.text, {color: textColor}]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  defaultVariant: {
    backgroundColor: '#4d5d30',
  },
  destructiveVariant: {
    backgroundColor: '#cc3333',
  },
  outlineVariant: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#4d5d30',
  },
  ghostVariant: {
    backgroundColor: 'transparent',
  },
  defaultSize: {
    paddingVertical: 14,
  },
  smSize: {
    paddingVertical: 10,
  },
  lgSize: {
    paddingVertical: 18,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
