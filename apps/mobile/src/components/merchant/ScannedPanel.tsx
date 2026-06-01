import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DetailRow } from './DetailRow';
import { OptionButton } from './OptionButton';
import { AppCard } from '../ui/AppCard';
import { AppButton } from '../ui/AppButton';
import { OfflinePaymentPayload } from '../../types/payment';
import { formatCurrency } from '../../utils/formatCurrency';
import { colors, shadows } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { radius } from '../../constants/radius';
import { typography } from '../../constants/typography';

export type ScannedPanelProps = {
  payload: OfflinePaymentPayload;
  isDemoPayload: boolean;
  merchantShortId?: string;
  onPrepareSms: () => void;
  onAcceptOffline: () => void;
  onScanAnother: () => void;
};

export function ScannedPanel({
  payload,
  isDemoPayload,
  merchantShortId,
  onPrepareSms,
  onAcceptOffline,
  onScanAnother,
}: ScannedPanelProps) {
  function shortenPublicKey(key: string) {
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  function formatCreatedAt(createdAt: string) {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
      return createdAt;
    }
    return date.toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  return (
    <View style={styles.resultContent}>
      <AppCard bordered style={styles.paymentCard}>
        <View style={styles.resultTopRow}>
          <View>
            <Text style={styles.resultEyebrow}>PAYMENT DETECTED</Text>
            <Text style={styles.resultAmount}>{formatCurrency(payload.amount)}</Text>
          </View>
          <View style={styles.readyPill}>
            <View style={styles.readyDot} />
            <Text style={styles.readyText}>READY</Text>
          </View>
        </View>

        {isDemoPayload ? (
          <View style={styles.demoBadgeContainer}>
            <Text style={styles.demoBadge}>Simulation Mode</Text>
          </View>
        ) : null}

        <View style={styles.paymentSummary}>
          <DetailRow label="Customer" value={payload.customerShortId} />
          <DetailRow label="Merchant" value={payload.merchantShortId} />
          {payload.customerPublicKey ? (
            <DetailRow label="Customer Key" value={shortenPublicKey(payload.customerPublicKey)} />
          ) : null}
          <DetailRow label="Created At" value={formatCreatedAt(payload.createdAt)} />
          <DetailRow label="Currency" value={payload.currency} />
        </View>

        {!merchantShortId ? (
          <Text style={styles.mvpNotice}>Register this device as a merchant to settle payments.</Text>
        ) : null}
      </AppCard>

      <View style={styles.optionStack}>
        <OptionButton
          title="Verify via SMS"
          description="Send payload to SMS gateway for on-chain settlement."
          icon="chatbubble-ellipses-outline"
          onPress={onPrepareSms}
        />
        <OptionButton
          title="Accept Offline"
          description="Queue this voucher to settle whenever you are online."
          icon="cloud-offline-outline"
          onPress={onAcceptOffline}
        />
      </View>

      <AppButton
        title="Scan Another"
        onPress={onScanAnother}
        variant="outline"
        icon={<Ionicons name="scan-outline" size={18} color={colors.ink} />}
        style={styles.bottomScanAnother}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  resultContent: {
    flexGrow: 1,
  },
  paymentCard: {
    padding: spacing.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  resultTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  resultEyebrow: {
    color: colors.muted,
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 1,
  },
  resultAmount: {
    color: colors.ink,
    fontSize: 38,
    fontWeight: '900',
    marginTop: spacing.xs,
    letterSpacing: -0.5,
  },
  readyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(22, 199, 132, 0.12)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  readyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  readyText: {
    color: colors.success,
    fontSize: 9,
    fontWeight: '900',
  },
  demoBadgeContainer: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  demoBadge: {
    color: colors.mutedDark,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentSummary: {
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  mvpNotice: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
    fontWeight: '700',
    marginTop: spacing.md,
  },
  optionStack: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  bottomScanAnother: {
    marginTop: spacing.xxl,
    borderRadius: radius.xl,
  },
});
