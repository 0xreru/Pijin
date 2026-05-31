import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors, shadows } from '../../constants/theme';
import { typography } from '../../constants/typography';
import { formatCurrency } from '../../utils/formatCurrency';

type BalanceCardProps = {
  label: string;
  amount?: number;
  displayAmount?: string;
  status?: string;
  variant?: 'total' | 'offline';
  children?: ReactNode;
};

export function BalanceCard({ label, amount = 0, displayAmount, status, variant = 'total', children }: BalanceCardProps) {
  return (
    <View style={[styles.card, variant === 'offline' && styles.offlineCard]}>
      {children}
      <View style={styles.bottomContent}>
        <Text style={[styles.amount, variant === 'offline' && styles.offlineAmount]}>
          {displayAmount ?? formatCurrency(amount)}
        </Text>
        <Text style={[styles.label, variant === 'offline' && styles.offlineLabel]}>{label}</Text>
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>
    </View>
  );
}

export function OfflineCardHeader() {
  return (
    <View style={styles.offlineHeader}>
      <View style={styles.offlineLabelRow}>
        <View style={styles.whiteDot} />
        <Text style={styles.offlineHeaderText}>Offline Balance</Text>
      </View>
      <View style={styles.cashIcon}>
        <Ionicons name="cash-outline" size={24} color={colors.offline} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.offline,
    borderRadius: radius.xl,
    minHeight: 304,
    padding: spacing.xxl,
    justifyContent: 'space-between',
    ...shadows.card,
  },
  offlineCard: {
    minHeight: 232,
    borderRadius: radius.xl,
  },
  bottomContent: {
    justifyContent: 'flex-end',
  },
  label: {
    ...typography.caption,
    color: '#D8D8D8',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  offlineLabel: {
    textTransform: 'none',
    marginTop: 0,
  },
  amount: {
    ...typography.display,
    color: colors.surface,
  },
  offlineAmount: {
    fontSize: 40,
    lineHeight: 46,
  },
  status: {
    ...typography.caption,
    color: colors.surface,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  offlineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  offlineLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  whiteDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.surface,
  },
  offlineHeaderText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '500',
  },
  cashIcon: {
    width: 33,
    height: 25,
    borderRadius: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
