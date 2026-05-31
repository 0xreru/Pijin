import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors, shadows } from '../../constants/theme';
import { typography } from '../../constants/typography';
import { SettlementStep } from '../../types/transaction';
import { formatCurrency } from '../../utils/formatCurrency';
import { SettlementTimeline } from './SettlementTimeline';

type ReceiptCardProps = {
  amount: number;
  payer: string;
  date: string;
  refId: string;
  steps: SettlementStep[];
};

export function ReceiptCard({ amount, payer, date, refId, steps }: ReceiptCardProps) {
  return (
    <View style={styles.receiptWrap}>
      <View style={styles.receipt}>
        <Text style={styles.eyebrow}>OFFLINE VERIFICATION</Text>
        <Text style={styles.amount}>{formatCurrency(amount)}</Text>
        <View style={styles.dottedDivider} />

        <View style={styles.info}>
          <InfoRow label="Payer" value={payer} />
          <InfoRow label="Date" value={date} />
          <InfoRow label="Ref ID" value={refId} />
        </View>

        <View style={styles.timelineBox}>
          <View style={styles.timelineHeader}>
            <Text style={styles.timelineTitle}>SETTLEMENT STATUS</Text>
            <Text style={styles.pending}>PENDING</Text>
          </View>
          <SettlementTimeline steps={steps} />
        </View>
      </View>
      <View style={styles.shadowStrip} />
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  receiptWrap: {
    alignSelf: 'center',
    width: '83%',
    maxWidth: 300,
    ...shadows.receipt,
  },
  receipt: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xxxl,
    paddingTop: 40,
    paddingBottom: spacing.xxxl,
  },
  eyebrow: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
    fontWeight: '600',
  },
  amount: {
    ...typography.amount,
    color: colors.ink,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  dottedDivider: {
    borderBottomWidth: 1,
    borderStyle: 'dotted',
    borderBottomColor: colors.ink,
    marginTop: spacing.xxl,
    marginBottom: spacing.xxxl,
  },
  info: {
    gap: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  infoLabel: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 13,
    fontWeight: '500',
  },
  infoValue: {
    ...typography.caption,
    color: colors.ink,
    flexShrink: 1,
    textAlign: 'right',
    fontWeight: '900',
  },
  timelineBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#D7C7C7',
    marginTop: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  timelineTitle: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: '900',
    fontSize: 11,
  },
  pending: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '900',
    fontSize: 11,
  },
  shadowStrip: {
    height: 15,
    backgroundColor: '#C8C8C8',
  },
});
