import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors, shadows } from '../../constants/theme';
import { typography } from '../../constants/typography';
import { Transaction } from '../../types/transaction';
import { formatCurrency } from '../../utils/formatCurrency';

type TransactionItemProps = {
  transaction: Transaction;
};

export function TransactionItem({ transaction }: TransactionItemProps) {
  const isIncoming = transaction.type === 'incoming';

  return (
    <View style={styles.row}>
      <View style={[styles.icon, isIncoming ? styles.iconIncoming : styles.iconOutgoing]}>
        <Ionicons
          name={isIncoming ? 'arrow-down-outline' : 'arrow-up-outline'}
          size={20}
          color={isIncoming ? '#10B981' : colors.ink}
        />
      </View>

      <View style={styles.copy}>
        <Text style={styles.title}>{transaction.title}</Text>
        <Text style={styles.subtitle}>{transaction.subtitle}</Text>
      </View>

      <Text style={[styles.amount, isIncoming ? styles.amountIncoming : styles.amountOutgoing]}>
        {transaction.displayAmount ??
          `${transaction.amount < 0 ? '-' : '+'}${formatCurrency(Math.abs(transaction.amount))}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.soft,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconIncoming: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  iconOutgoing: {
    backgroundColor: 'rgba(8, 9, 10, 0.04)',
  },
  copy: {
    flex: 1,
  },
  title: {
    ...typography.caption,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
    color: colors.ink,
  },
  subtitle: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: '500',
    marginTop: 2,
    fontSize: 11,
  },
  amount: {
    ...typography.caption,
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  amountIncoming: {
    color: '#10B981',
  },
  amountOutgoing: {
    color: colors.ink,
  },
});
