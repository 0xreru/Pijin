import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { radius } from '../../constants/radius';

export type SmallDebugButtonProps = {
  onPress: () => void;
};

export function SmallDebugButton({ onPress }: SmallDebugButtonProps) {
  return (
    <Pressable style={({ pressed }) => [styles.debugButton, pressed && styles.pressed]} onPress={onPress}>
      <Ionicons name="bug-outline" size={14} color={colors.mutedDark} />
      <Text style={styles.debugButtonText}>Use Demo Payload</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  debugButton: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.lg,
  },
  debugButtonText: {
    color: colors.mutedDark,
    fontSize: 11,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
});
