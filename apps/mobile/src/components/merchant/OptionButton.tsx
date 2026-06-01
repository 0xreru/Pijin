import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { radius } from '../../constants/radius';
import { typography } from '../../constants/typography';
import { shadows } from '../../constants/theme';

export type OptionButtonProps = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

export function OptionButton({ title, description, icon, onPress }: OptionButtonProps) {
  return (
    <Pressable style={({ pressed }) => [styles.optionButton, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.optionIcon}>
        <Ionicons name={icon} size={20} color={colors.ink} />
      </View>
      <View style={styles.optionTextWrap}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  optionButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.soft,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8, 9, 10, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTextWrap: {
    flex: 1,
  },
  optionTitle: {
    ...typography.body,
    fontWeight: '800',
    color: colors.ink,
  },
  optionDescription: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.85,
  },
});
