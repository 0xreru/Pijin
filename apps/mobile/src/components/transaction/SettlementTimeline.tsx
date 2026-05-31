import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/theme';
import { SettlementStep } from '../../types/transaction';

type SettlementTimelineProps = {
  steps: SettlementStep[];
};

export function SettlementTimeline({ steps }: SettlementTimelineProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.rail} />
      <View style={styles.steps}>
        {steps.map((step) => (
          <View key={step.label} style={styles.step}>
            <View style={[styles.dot, step.status === 'done' && styles.doneDot, step.status === 'active' && styles.activeDot]}>
              {step.status === 'done' ? <Ionicons name="checkmark" size={10} color={colors.surface} /> : null}
            </View>
            <Text style={styles.label}>{step.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 45,
    justifyContent: 'center',
  },
  rail: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    height: 3,
    backgroundColor: colors.ink,
  },
  steps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  step: {
    width: 64,
    alignItems: 'center',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneDot: {
    borderColor: colors.success,
    backgroundColor: colors.success,
  },
  activeDot: {
    borderColor: colors.ink,
  },
  label: {
    marginTop: 3,
    color: colors.muted,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 11,
    fontWeight: '500',
  },
});
