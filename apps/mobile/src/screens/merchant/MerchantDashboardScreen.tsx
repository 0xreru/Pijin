import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { MerchantBottomNavBar, MerchantTab } from '../../components/ui/MerchantBottomNavBar';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors, shadows } from '../../constants/theme';
import { typography } from '../../constants/typography';
import { getMerchantSettlements, type SettlementRecord } from '../../services/api/transactions';
import { useStellarAccount } from '../../hooks/useStellarAccount';
import { formatCurrency } from '../../utils/formatCurrency';
import { loadOfflinePaymentsQueue } from '../../services/storage/paymentQueueStorage';
import { OfflinePaymentPayload } from '../../types/payment';

type MerchantDashboardScreenProps = {
  connectedPublicKey?: string;
  merchantShortId?: string;
  onMerchantTabPress?: (tab: MerchantTab) => void;
  onScanPress?: () => void;
  onLogout?: () => void;
};

export function MerchantDashboardScreen({
  connectedPublicKey,
  merchantShortId,
  onMerchantTabPress,
  onScanPress,
  onLogout,
}: MerchantDashboardScreenProps) {
  const isFocused = useIsFocused();
  const { account, isLoading, error } = useStellarAccount(connectedPublicKey);
  const walletStatus = getWalletStatus({ connectedPublicKey, account, isLoading, error });
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<OfflinePaymentPayload[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!merchantShortId) {
      return;
    }
    getMerchantSettlements(merchantShortId)
      .then(setSettlements)
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : 'Unable to load settlements.')
      );
  }, [merchantShortId]);

  useEffect(() => {
    if (isFocused) {
      loadOfflinePaymentsQueue()
        .then(setOfflineQueue)
        .catch((err) => console.error('[Dashboard] failed to load offline queue:', err));
    }
  }, [isFocused]);

  const todayTotal = settlements.reduce(
    (sum, row) => sum + Number.parseFloat(row.amountPhp || '0'),
    0
  );

  // Status-based dot/indicator color configuration
  let statusDotColor = colors.danger;
  let statusBg = 'rgba(240, 68, 56, 0.08)'; // Translucent danger red
  if (connectedPublicKey) {
    if (isLoading) {
      statusDotColor = colors.warning;
      statusBg = 'rgba(245, 160, 0, 0.08)'; // Translucent warning orange
    } else if (error) {
      statusDotColor = colors.danger;
      statusBg = 'rgba(240, 68, 56, 0.08)';
    } else if (account && !account.exists) {
      statusDotColor = colors.warning;
      statusBg = 'rgba(245, 160, 0, 0.08)';
    } else {
      statusDotColor = colors.success;
      statusBg = 'rgba(22, 199, 132, 0.08)'; // Translucent success green
    }
  }

  return (
    <ScreenContainer scroll={false} contentStyle={styles.screen} backgroundColor={colors.backgroundSoft}>
      <View style={styles.root}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          
          {/* Header Profile Section */}
          <View style={styles.header}>
            <View style={styles.avatarContainer}>
              <Ionicons name="storefront" size={24} color={colors.ink} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.merchantName} numberOfLines={1}>
                {merchantShortId ? `Merchant ${merchantShortId}` : 'Not registered'}
              </Text>
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
            <Pressable style={({ pressed }) => [styles.headerLogoutButton, pressed && styles.pressed]} onPress={onLogout}>
              <Ionicons name="log-out-outline" size={20} color={colors.surface} />
            </Pressable>
          </View>

          {/* Connection Status Badge */}
          <View style={[styles.statusCard, { backgroundColor: statusBg }]}>
            <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
            <Text style={[styles.statusText, { color: statusDotColor === colors.danger ? colors.danger : colors.inkSoft }]}>
              {walletStatus}
            </Text>
          </View>

          {/* Premium Sales Volume Card */}
          <View style={styles.salesCard}>
            <View style={styles.salesHeader}>
              <Text style={styles.salesLabel}>TOTAL SALES TODAY</Text>
              <View style={styles.syncBadge}>
                <Ionicons name="checkmark-circle" size={10} color={colors.success} />
                <Text style={styles.syncText}>ACTIVE</Text>
              </View>
            </View>
            
            <Text style={styles.salesAmount}>{formatCurrency(todayTotal)}</Text>
            
            <View style={styles.salesDivider} />
            
            <View style={styles.salesFooter}>
              <Ionicons name="receipt-outline" size={13} color="rgba(255, 255, 255, 0.7)" />
              <Text style={styles.salesSub}>
                {settlements.length} payment{settlements.length === 1 ? '' : 's'} settled today
              </Text>
            </View>
          </View>

          {loadError ? <Text style={styles.loadError}>{loadError}</Text> : null}

          {/* Offline Queued Payments */}
          {offlineQueue.length > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Offline Queued Payments</Text>
                <Text style={styles.sectionAction}>{offlineQueue.length} pending</Text>
              </View>
              <AppCard bordered style={styles.transactionsCard}>
                {offlineQueue.map((payment, index) => {
                  const isLast = index === offlineQueue.length - 1;
                  return (
                    <View key={index} style={[styles.paymentRow, isLast && styles.paymentRowLast]}>
                      <View style={[styles.paymentIconContainer, { backgroundColor: 'rgba(16, 16, 16, 0.06)' }]}>
                        <Ionicons name="cloud-offline" size={18} color={colors.offline} />
                      </View>
                      <View style={styles.paymentInfo}>
                        <Text style={styles.paymentCustomer} numberOfLines={1}>
                          Customer: {payment.customerShortId}
                        </Text>
                        <Text style={styles.paymentMeta}>
                          Voucher created: {formatTime(payment.createdAt)}
                        </Text>
                      </View>
                      <View style={styles.paymentAmountContainer}>
                        <Text style={styles.paymentTitle}>✦{Number(payment.amount || 0).toFixed(2)}</Text>
                        <View style={[styles.statusBadge, { backgroundColor: 'rgba(16, 16, 16, 0.08)' }]}>
                          <Text style={[styles.statusBadgeText, { color: colors.inkSoft }]}>
                            QUEUED
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </AppCard>
            </View>
          ) : null}

          {/* Settlements Section */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Settlements</Text>
            {settlements.length > 0 && (
              <Text style={styles.sectionAction}>{settlements.length} total</Text>
            )}
          </View>

          {settlements.length === 0 ? (
            <AppCard bordered style={styles.emptyCard}>
              <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.muted} />
              <Text style={styles.empty}>Scan customer QR and settle via SMS or developer simulation.</Text>
            </AppCard>
          ) : (
            <AppCard bordered style={styles.transactionsCard}>
              {settlements.slice(0, 5).map((payment, index) => {
                const isLast = index === Math.min(settlements.length, 5) - 1;
                const isSettled = payment.status?.toLowerCase() === 'settled';
                const statusColor = isSettled ? colors.success : colors.warning;
                const statusBgColor = isSettled ? 'rgba(22, 199, 132, 0.1)' : 'rgba(245, 160, 0, 0.1)';

                return (
                  <View key={payment.id} style={[styles.paymentRow, isLast && styles.paymentRowLast]}>
                    <View style={styles.paymentIconContainer}>
                      <Ionicons name="arrow-down" size={18} color={colors.success} />
                    </View>
                    <View style={styles.paymentInfo}>
                      <Text style={styles.paymentCustomer} numberOfLines={1}>
                        Customer: {payment.customerShortId}
                      </Text>
                      <Text style={styles.paymentMeta}>
                        {formatTime(payment.createdAt)}
                      </Text>
                    </View>
                    <View style={styles.paymentAmountContainer}>
                      <Text style={styles.paymentTitle}>✦{Number(payment.amountPhp || '0').toFixed(2)}</Text>
                      <View style={[styles.statusBadge, { backgroundColor: statusBgColor }]}>
                        <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                          {payment.status?.toUpperCase() || 'PENDING'}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </AppCard>
          )}

          {/* Dynamic Scan Trigger Button */}
          <AppButton
            title="Scan customer QR"
            onPress={onScanPress}
            variant="primary"
            icon={<Ionicons name="scan-outline" size={18} color={colors.surface} />}
            style={styles.scanButton}
          />
         </ScrollView>
      </View>
    </ScreenContainer>
  );
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function shortenPublicKey(publicKey: string) {
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
}

function getWalletStatus({
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
    return 'Connect a merchant wallet on mainnet.';
  }
  if (isLoading) {
    return 'Loading Horizon balance...';
  }
  if (error) {
    return error;
  }
  if (account && !account.exists) {
    return 'Wallet connected; fund mainnet account for fees.';
  }
  return `Horizon XLM: ${account?.xlmBalance ?? '0'}`;
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
    marginBottom: spacing.md,
  },
  avatarContainer: {
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
  merchantName: {
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
  headerLogoutButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButton: {
    minHeight: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xl,
  },
  logoutButtonText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm * 1.2,
    borderRadius: radius.md,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 11,
    flex: 1,
  },
  salesCard: {
    marginTop: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    ...shadows.card,
  },
  salesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  salesLabel: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1.2,
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(22, 199, 132, 0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  syncText: {
    color: colors.success,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  salesAmount: {
    color: colors.surface,
    fontSize: 38,
    fontWeight: '900',
    marginTop: spacing.sm,
    letterSpacing: -0.5,
  },
  salesDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: spacing.lg,
  },
  salesFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  salesSub: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '700',
    fontSize: 12,
  },
  loadError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.md,
    textAlign: 'center',
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.title,
    fontSize: 18,
    color: colors.ink,
    fontWeight: '800',
  },
  sectionAction: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    gap: spacing.sm,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  empty: {
    ...typography.body,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  transactionsCard: {
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  paymentRowLast: {
    borderBottomWidth: 0,
  },
  paymentIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22, 199, 132, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  paymentInfo: {
    flex: 1,
  },
  paymentCustomer: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '800',
    color: colors.ink,
  },
  paymentMeta: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  paymentAmountContainer: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  paymentTitle: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  scanButton: {
    marginTop: spacing.xxl,
    borderRadius: radius.xl,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  pressed: {
    opacity: 0.85,
  },
  fixedNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.backgroundSoft,
  },
});

