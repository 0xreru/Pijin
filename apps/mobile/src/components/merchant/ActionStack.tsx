import React from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppButton } from '../ui/AppButton';
import { spacing } from '../../constants/spacing';
import { colors } from '../../constants/theme';

export type ActionStackProps = {
  onScanAnother: () => void;
  onBackToDashboard?: () => void;
  onViewHistory?: () => void;
};

export function ActionStack({ onScanAnother, onBackToDashboard, onViewHistory }: ActionStackProps) {
  return (
    <View style={styles.actionStack}>
      <AppButton
        title="Scan Another"
        onPress={onScanAnother}
        variant="primary"
        icon={<Ionicons name="scan-outline" size={18} color={colors.surface} />}
        style={{ marginTop: spacing.lg }}
      />
      {onViewHistory && (
        <AppButton
          title="View History"
          onPress={onViewHistory}
          variant="light"
          icon={<Ionicons name="time-outline" size={18} color={colors.ink} />}
          style={{ marginTop: spacing.md }}
        />
      )}
      {onBackToDashboard && (
        <AppButton
          title="Back to Dashboard"
          onPress={onBackToDashboard}
          variant="outline"
          icon={<Ionicons name="grid-outline" size={18} color={colors.ink} />}
          style={{ marginTop: spacing.md }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actionStack: {
    width: '100%',
    marginTop: spacing.xl,
  },
});
