import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors } from '../../constants/theme';
import { typography } from '../../constants/typography';
import { formatCurrency } from '../../utils/formatCurrency';

type AmountDisplayProps = {
  label: string;
  amount: string | number;
  badge: string;
};

export function AmountDisplay({ label, amount, badge }: AmountDisplayProps) {
  const numericAmount = typeof amount === 'string' ? Number(amount) || 0 : amount;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.amount}>{formatCurrency(numericAmount)}</Text>
      <View style={styles.badge}>
        <View style={styles.badgeDot} />
        <Text style={styles.badgeText}>{badge.toUpperCase()}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  amount: {
    color: colors.ink,
    fontSize: 48,
    fontWeight: '900',
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(8, 9, 10, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(8, 9, 10, 0.08)',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  badgeText: {
    color: colors.mutedDark,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
