import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusPanel } from './StatusPanel';
import { ActionStack } from './ActionStack';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { radius } from '../../constants/radius';
import { typography } from '../../constants/typography';

export type QueuedPanelProps = {
  pendingCount: number;
  onScanAnother: () => void;
  onBackToDashboard?: () => void;
  onViewHistory?: () => void;
};

export function QueuedPanel({
  pendingCount,
  onScanAnother,
  onBackToDashboard,
  onViewHistory,
}: QueuedPanelProps) {
  return (
    <StatusPanel icon="archive" title="Queued Offline">
      <Text style={styles.panelText}>
        Payment voucher saved to local queue. Will sync automatically when online.
      </Text>
      <View style={styles.queueCountBadge}>
        <Text style={styles.queueCountText}>
          {pendingCount} payment{pendingCount === 1 ? '' : 's'} queued
        </Text>
      </View>
      <ActionStack
        onScanAnother={onScanAnother}
        onBackToDashboard={onBackToDashboard}
        onViewHistory={onViewHistory}
      />
    </StatusPanel>
  );
}

const styles = StyleSheet.create({
  panelText: {
    ...typography.body,
    fontSize: 14,
    color: colors.mutedDark,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  queueCountBadge: {
    backgroundColor: 'rgba(8, 9, 10, 0.05)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginTop: spacing.xl,
  },
  queueCountText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
});
