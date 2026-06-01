import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { typography } from '../../constants/typography';

export type DetailRowProps = {
  label: string;
  value: string;
};

export function DetailRow({ label, value }: DetailRowProps) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: '700',
  },
  detailValue: {
    ...typography.body,
    fontSize: 13,
    color: colors.ink,
    fontWeight: '800',
  },
});
