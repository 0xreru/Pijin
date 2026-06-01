import React from 'react';
import { StyleSheet, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusPanel } from './StatusPanel';
import { AppButton } from '../ui/AppButton';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { typography } from '../../constants/typography';

export type InvalidPanelProps = {
  error: string | null;
  onRetry: () => void;
};

export function InvalidPanel({ error, onRetry }: InvalidPanelProps) {
  return (
    <StatusPanel icon="alert-circle" title="Invalid QR Code" tone="danger">
      <Text style={styles.panelText}>{error ?? 'Scanned code could not be parsed.'}</Text>
      <AppButton
        title="Try Again"
        onPress={onRetry}
        variant="primary"
        icon={<Ionicons name="refresh-outline" size={18} color={colors.surface} />}
        style={{ marginTop: spacing.xl }}
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
});
