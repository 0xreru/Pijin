import React, { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppCard } from '../ui/AppCard';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { radius } from '../../constants/radius';
import { typography } from '../../constants/typography';
import { shadows } from '../../constants/theme';

export type StatusPanelProps = {
  children: ReactNode;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  tone?: 'success' | 'danger';
};

export function StatusPanel({ children, icon, title, tone = 'success' }: StatusPanelProps) {
  const iconColor = tone === 'danger' ? colors.danger : colors.success;
  const iconBg = tone === 'danger' ? 'rgba(240, 68, 56, 0.08)' : 'rgba(22, 199, 132, 0.08)';

  return (
    <AppCard bordered style={styles.statusContentCard}>
      <View style={[styles.statusIconContainer, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={28} color={iconColor} />
      </View>
      <Text style={styles.statusPanelTitle}>{title}</Text>
      {children}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  statusContentCard: {
    width: '100%',
    padding: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  statusIconContainer: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  statusPanelTitle: {
    ...typography.title,
    fontSize: 20,
    fontWeight: '900',
    color: colors.ink,
    textAlign: 'center',
  },
});
