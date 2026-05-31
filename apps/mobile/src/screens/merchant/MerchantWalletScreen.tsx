import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { MerchantBottomNavBar, MerchantTab } from '../../components/ui/MerchantBottomNavBar';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { AppCard } from '../../components/ui/AppCard';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors, shadows } from '../../constants/theme';
import { typography } from '../../constants/typography';
import { getMerchantSettlements, type SettlementRecord } from '../../services/api/transactions';
import { useStellarAccount } from '../../hooks/useStellarAccount';
import { formatCurrency } from '../../utils/formatCurrency';

type MerchantWalletScreenProps = {
  connectedPublicKey?: string;
  merchantShortId?: string;
  onMerchantTabPress?: (tab: MerchantTab) => void;
  onLogout?: () => void;
};

export function MerchantWalletScreen({
  connectedPublicKey,
  merchantShortId,
  onMerchantTabPress,
  onLogout,
}: MerchantWalletScreenProps) {
  const { account, isLoading, error } = useStellarAccount(connectedPublicKey);
  const realBalanceDisplay = getRealBalanceDisplay({ connectedPublicKey, account, isLoading, error });
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);

  useEffect(() => {
    if (!merchantShortId) {
      return;
    }
    getMerchantSettlements(merchantShortId).then(setSettlements).catch(() => setSettlements([]));
  }, [merchantShortId]);

  const totalReceived = settlements.reduce(
    (sum, row) => sum + Number.parseFloat(row.amountPhp || '0'),
    0
  );

  return (
    <ScreenContainer scroll={false} contentStyle={styles.screen} backgroundColor={colors.backgroundSoft}>
      <View style={styles.root}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          
          {/* Header Profile Section */}
          <WalletHeader connectedPublicKey={connectedPublicKey} onLogout={onLogout} />

          {/* Stellar mainnet card stack effect */}
          <View style={styles.cardStackShadow} />
          <View style={styles.walletCard}>
            <Text style={styles.walletLabel}>Stellar Mainnet Balance</Text>
            <Text style={styles.walletAmount}>{realBalanceDisplay.amount}</Text>
            <Text style={styles.walletStatus}>{realBalanceDisplay.status}</Text>

            <View style={styles.walletDivider} />

            <BalanceLine
              color={colors.success}
              label="Settled Volume"
              value={formatCurrency(totalReceived)}
              strong
            />
            <BalanceLine
              color={colors.warning}
              label="Merchant ID"
              value={merchantShortId ?? '—'}
            />
          </View>

          {/* Quick Metrics Grid */}
          <View style={styles.summaryGrid}>
            <SummaryTile label="Settled Payments" value={`${settlements.length}`} />
            <SummaryTile label="Total Received" value={formatCurrency(totalReceived)} />
          </View>

          {/* Vintage Receipt Style Transaction Ledger */}
          <View style={styles.ledgerSlot} />
          <View style={styles.ledger}>
            <Text style={styles.ledgerTitle}>Settlement Ledger</Text>

            {settlements.length === 0 ? (
              <View style={styles.emptyLedgerContainer}>
                <Ionicons name="receipt-outline" size={32} color={colors.muted} />
                <Text style={styles.emptyLedgerText}>No settlements processed yet.</Text>
              </View>
            ) : (
              settlements.map((item) => (
                <View key={item.id} style={styles.historyRow}>
                  <View style={styles.historyIconContainer}>
                    <Ionicons name="arrow-down" size={16} color={colors.ink} />
                  </View>
                  <View style={styles.historyCopy}>
                    <View style={styles.historyTitleRow}>
                      <Text style={styles.historyTitle} numberOfLines={1}>
                        From {item.customerShortId}
                      </Text>
                      <StatusBadge status={item.status} />
                    </View>
                    <Text style={styles.historyTime}>
                      {formatCreatedAt(item.createdAt)}
                    </Text>
                  </View>
                  <Text style={styles.historyAmount}>
                    +{formatCurrency(Number.parseFloat(item.amountPhp))}
                  </Text>
                </View>
              ))
            )}
          </View>
          <View style={styles.ledgerTear} />
        </ScrollView>
      </View>
    </ScreenContainer>
  );
}

function WalletHeader({
  connectedPublicKey,
  onLogout,
}: {
  connectedPublicKey?: string;
  onLogout?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={styles.headerAvatarContainer}>
          <Ionicons name="storefront" size={24} color={colors.ink} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Merchant Wallet</Text>
          {connectedPublicKey ? (
            <View style={styles.keyPill}>
              <Ionicons name="wallet-outline" size={10} color={colors.muted} />
              <Text style={styles.keyPillText}>{shortenPublicKey(connectedPublicKey)}</Text>
            </View>
          ) : (
            <View style={[styles.keyPill, styles.keyPillDisconnected]}>
              <Ionicons name="warning-outline" size={10} color={colors.danger} />
              <Text style={[styles.keyPillText, { color: colors.danger }]}>No merchant wallet</Text>
            </View>
          )}
        </View>
      </View>
      {onLogout && (
        <Pressable
          style={({ pressed }) => [styles.headerLogoutButton, pressed && styles.pressed]}
          onPress={onLogout}
        >
          <Ionicons name="log-out-outline" size={20} color={colors.surface} />
        </Pressable>
      )}
    </View>
  );
}

function shortenPublicKey(publicKey: string) {
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
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

function getRealBalanceDisplay({
  connectedPublicKey,
  account,
  isLoading,
  error,
}: {
  connectedPublicKey?: string;
  account: ReturnType<typeof useStellarAccount>['account'];
  isLoading: boolean;
  error: string | null;
}) {
  if (!connectedPublicKey) {
    return {
      amount: 'No Wallet',
      status: 'Connect wallet on mainnet to load real balance.',
    };
  }

  if (isLoading) {
    return {
      amount: 'Loading...',
      status: 'Retrieving Horizon live balance.',
    };
  }

  if (error) {
    return {
      amount: 'Error',
      status: error,
    };
  }

  if (account && !account.exists) {
    return {
      amount: '0.0 XLM',
      status: 'Stellar account is not funded yet.',
    };
  }

  if (account) {
    return {
      amount: `${account.xlmBalance} XLM`,
      status: `Active account with ${account.balances.length} trustline${account.balances.length === 1 ? '' : 's'}.`,
    };
  }

  return {
    amount: '0.0 XLM',
    status: 'Connect wallet on mainnet to load real balance.',
  };
}

function BalanceLine({
  color,
  label,
  value,
  strong = false,
}: {
  color: string;
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.balanceLine}>
      <View style={[styles.balanceDot, { backgroundColor: color }]} />
      <Text style={[styles.balanceText, strong && styles.balanceTextStrong]}>
        {label}: {value}
      </Text>
    </View>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <AppCard bordered style={styles.summaryTile}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </AppCard>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isSuccess = status === 'SUCCESS' || status === 'SETTLED';
  const isFailed = status === 'FAILED';

  const badgeBg = isSuccess 
    ? 'rgba(22, 199, 132, 0.08)' 
    : isFailed 
      ? 'rgba(240, 68, 56, 0.08)' 
      : 'rgba(141, 141, 141, 0.08)';
      
  const textColor = isSuccess 
    ? colors.success 
    : isFailed 
      ? colors.danger 
      : colors.muted;

  return (
    <View style={[styles.badgeContainer, { backgroundColor: badgeBg }]}>
      <Text style={[styles.badgeText, { color: textColor }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + spacing.md : spacing.md,
  },
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: 140,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xl,
    width: '100%',
  },
  headerLogoutButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  headerAvatarContainer: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  headerCopy: {
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.title,
    fontSize: 22,
    lineHeight: 26,
    color: colors.ink,
    fontWeight: '900',
  },
  keyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyPillDisconnected: {
    borderColor: 'rgba(240, 68, 56, 0.2)',
    backgroundColor: 'rgba(240, 68, 56, 0.04)',
  },
  keyPillText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
  },
  cardStackShadow: {
    height: 12,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surfaceMuted,
    marginHorizontal: spacing.lg,
    marginBottom: -6,
    opacity: 0.6,
  },
  walletCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.xl * 1.25,
    ...shadows.card,
    marginBottom: spacing.xl,
  },
  walletLabel: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  walletAmount: {
    color: colors.surface,
    fontSize: 34,
    fontWeight: '900',
    marginTop: spacing.sm,
    letterSpacing: -0.5,
  },
  walletStatus: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  walletDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginVertical: spacing.lg,
  },
  balanceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  balanceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  balanceText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    fontWeight: '700',
  },
  balanceTextStrong: {
    color: colors.surface,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  summaryTile: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    ...shadows.soft,
    alignItems: 'flex-start',
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    marginTop: spacing.xs,
  },
  ledgerSlot: {
    height: 8,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    backgroundColor: colors.inkSoft,
    marginHorizontal: spacing.lg,
    marginBottom: -2,
    zIndex: 1,
    opacity: 0.9,
  },
  ledger: {
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    ...shadows.receipt,
  },
  ledgerTitle: {
    ...typography.sectionTitle,
    fontSize: 16,
    fontWeight: '900',
    color: colors.ink,
    marginBottom: spacing.md,
  },
  emptyLedgerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  emptyLedgerText: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: '700',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    gap: spacing.md,
  },
  historyIconContainer: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8, 9, 10, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCopy: {
    flex: 1,
  },
  historyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  historyTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  historyTime: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  historyAmount: {
    color: colors.mutedDark,
    fontSize: 15,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  badgeContainer: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  ledgerTear: {
    height: 12,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderStyle: 'dashed',
  },
  fixedNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
});
