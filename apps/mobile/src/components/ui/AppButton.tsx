import React from 'react';
import { StyleSheet, Text, TouchableOpacity, ActivityIndicator, View, ViewStyle, TextStyle } from 'react-native';
import { typography } from '../../constants/typography';

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'text';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
  textStyle,
}: AppButtonProps) {
  const getButtonStyles = () => {
    const baseStyle: ViewStyle[] = [styles.button];
    
    if (variant === 'primary') {
      baseStyle.push(styles.primaryButton);
    } else if (variant === 'secondary') {
      baseStyle.push(styles.secondaryButton);
    } else if (variant === 'outline') {
      baseStyle.push(styles.outlineButton);
    } else if (variant === 'text') {
      baseStyle.push(styles.textButton);
    }

    if (disabled) {
      baseStyle.push(styles.disabledButton);
    }

    if (style) {
      baseStyle.push(style);
    }

    return baseStyle;
  };

  const getTextStyle = () => {
    const baseText: TextStyle[] = [styles.buttonText];

    if (variant === 'primary') {
      baseText.push(styles.primaryText);
    } else if (variant === 'secondary') {
      baseText.push(styles.secondaryText);
    } else if (variant === 'outline') {
      baseText.push(styles.outlineText);
    } else if (variant === 'text') {
      baseText.push(styles.textOnlyStyle);
    }

    if (disabled) {
      baseText.push(styles.disabledText);
    }

    if (textStyle) {
      baseText.push(textStyle);
    }

    return baseText;
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={getButtonStyles()}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? '#000000' : '#FFFFFF'} size="small" />
      ) : (
        <View style={styles.contentContainer}>
          {icon && <View style={styles.iconContainer}>{icon}</View>}
          <Text style={getTextStyle()}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginVertical: 6,
  },
  primaryButton: {
    backgroundColor: '#031634', // Deep Navy Blue theme
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  textButton: {
    backgroundColor: 'transparent',
    height: 'auto',
    paddingVertical: 8,
  },
  disabledButton: {
    backgroundColor: '#E5E7EB',
    borderColor: '#E5E7EB',
  },
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    marginRight: 8,
  },
  buttonText: {
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    fontWeight: '700',
  },
  primaryText: {
    color: '#FFFFFF',
  },
  secondaryText: {
    color: '#08090A',
  },
  outlineText: {
    color: '#FFFFFF',
  },
  textOnlyStyle: {
    color: '#707984',
  },
  disabledText: {
    color: '#9CA3AF',
  },
});
