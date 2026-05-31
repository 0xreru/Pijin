import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors } from '../../constants/theme';
import { typography } from '../../constants/typography';

type AppButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'light' | 'outline';
  compact?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
};

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  compact = false,
  icon,
  style,
  disabled = false,
}: AppButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        variant === 'primary' && styles.primary,
        variant === 'light' && styles.light,
        variant === 'outline' && styles.outline,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          variant === 'primary' && styles.primaryText,
          variant === 'light' && styles.lightText,
          variant === 'outline' && styles.outlineText,
        ]}
      >
        {title}
      </Text>
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  compact: {
    minHeight: 44,
    paddingHorizontal: spacing.xxl,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  light: {
    backgroundColor: colors.pill,
  },
  outline: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.58,
  },
  text: {
    ...typography.button,
    letterSpacing: 0,
  },
  primaryText: {
    color: colors.surface,
  },
  lightText: {
    color: colors.ink,
  },
  outlineText: {
    color: colors.ink,
  },
});
