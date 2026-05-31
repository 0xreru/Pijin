import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { TransactionItem } from '../components/transaction/TransactionItem';
import { BottomNavBar, BottomTab } from '../components/ui/BottomNavBar';
import { ScreenContainer } from '../components/ui/ScreenContainer';
import { SectionHeader } from '../components/ui/SectionHeader';
import { BalanceCard } from '../components/wallet/BalanceCard';
import { radius } from '../constants/radius';
import { spacing } from '../constants/spacing';
import { colors, shadows } from '../constants/theme';
import { typography } from '../constants/typography';
import { useStellarAccount } from '../hooks/useStellarAccount';
import { useVaultBalance } from '../hooks/useVaultBalance';
import { Transaction } from '../types/transaction';

type OnlineOfflineWalletScreenProps = {
  bottomTab?: BottomTab;
  connectedPublicKey?: string;
  shortId?: string;
  onBottomTabPress?: (tab: BottomTab) => void;
  onLogout?: () => void;
};

export function OnlineOfflineWalletScreen({
  bottomTab = 'Home',
  connectedPublicKey,
  shortId,
  onBottomTabPress,
  onLogout,
}: OnlineOfflineWalletScreenProps) {
  const { account, recentPayments, isLoading, error } = useStellarAccount(connectedPublicKey);
  const vault = useVaultBalance(shortId, connectedPublicKey);
  const transactions = recentPayments.map(toTransaction);
  const balanceDisplay = getBalanceDisplay({ account, isLoading, error, connectedPublicKey });
  const trustlineBalances = account?.balances.filter((balance) => balance.assetType !== 'native') ?? [];

  return (
    <ScreenContainer scroll={false} contentStyle={styles.screen}>
      <View style={styles.root}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <WalletHeader connectedPublicKey={connectedPublicKey} shortId={shortId} onLogout={onLogout} />

          <View style={styles.balanceWrap}>
            <BalanceCard
              label={balanceDisplay.label}
              displayAmount={balanceDisplay.amount}
              status={balanceDisplay.status}
            >
              <View style={styles.balanceGraphic}>
                <View style={styles.onlineLayer}>
                  <View style={styles.cardHeaderRow}>
                    <Ionicons name="globe-outline" size={14} color="rgba(255, 255, 255, 0.7)" />
                    <Text style={styles.onlineText}>ONLINE WALLET</Text>
                  </View>
                  <View style={styles.wifiChipRow}>
                    <Ionicons name="wifi" size={16} color="rgba(255, 255, 255, 0.5)" style={{ transform: [{ rotate: '90deg' }] }} />
                  </View>
                </View>
                <View style={styles.offlineLayer}>
                  <View style={styles.cardHeaderRow}>
                    <Ionicons name="shield-checkmark" size={14} color={colors.primary} />
                    <Text style={styles.offlineText}>OFFLINE VAULT</Text>
                  </View>
                  <View style={styles.vaultValueRow}>
                    <Text style={styles.vaultValueText}>
                      {vault.balancePhp !== null
                        ? `✦${vault.balancePhp.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '✦0.00'}
                    </Text>
                    <Ionicons name="hardware-chip-outline" size={20} color={colors.muted} />
                  </View>
                </View>
              </View>
              {trustlineBalances.length > 0 ? (
                <View style={styles.trustlineContainer}>
                  {trustlineBalances.slice(0, 2).map((balance) => (
                    <View key={`${balance.assetCode}:${balance.assetIssuer ?? balance.assetType}`} style={styles.trustlineBadge}>
                      <View style={styles.trustlineDot} />
                      <Text style={styles.trustlineText}>
                        {balance.assetCode} {Number(balance.balance).toLocaleString('en-PH', { maximumFractionDigits: 2 })}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </BalanceCard>
          </View>

          <View style={styles.section}>
            <SectionHeader title="Recent Activity" action="SEE ALL" />
            {transactions.length > 0 ? (
              <View style={styles.list}>
                {transactions.map((transaction) => (
                  <TransactionItem key={transaction.id} transaction={transaction} />
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>{getRecentActivityMessage({ connectedPublicKey, isLoading, error })}</Text>
            )}
          </View>
        </ScrollView>
      </View>
    </ScreenContainer>
  );
}

function WalletHeader({
  connectedPublicKey,
  shortId,
  onLogout,
}: {
  connectedPublicKey?: string;
  shortId?: string;
  onLogout?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={styles.headerAvatarContainer}>
          <Ionicons name="wallet-outline" size={22} color={colors.ink} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitleText}>Personal Wallet</Text>
          {shortId ? (
            <View style={styles.keyPill}>
              <Ionicons name="wallet-outline" size={10} color={colors.muted} />
              <Text style={styles.keyPillText}>ID: {shortId}</Text>
            </View>
          ) : connectedPublicKey ? (
            <View style={styles.keyPill}>
              <Ionicons name="wallet-outline" size={10} color={colors.muted} />
              <Text style={styles.keyPillText}>{shortenPublicKey(connectedPublicKey)}</Text>
            </View>
          ) : (
            <View style={[styles.keyPill, styles.keyPillDisconnected]}>
              <Ionicons name="warning-outline" size={10} color={colors.danger} />
              <Text style={[styles.keyPillText, { color: colors.danger }]}>No wallet connected</Text>
            </View>
          )}
        </View>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.headerLogoutButton,
          pressed && styles.pressed,
        ]}
        onPress={onLogout}
      >
        <Ionicons name="log-out-outline" size={22} color={colors.surface} />
      </Pressable>
    </View>
  );
}

function shortenPublicKey(publicKey: string) {
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
}

function toTransaction(payment: {
  id: string;
  title: string;
  subtitle: string;
  amount: string;
  assetCode: string;
  direction: 'incoming' | 'outgoing';
}): Transaction {
  const sign = payment.direction === 'incoming' ? '+' : '-';

  return {
    id: payment.id,
    title: payment.title,
    subtitle: payment.subtitle,
    amount: payment.direction === 'incoming' ? Number(payment.amount) : -Number(payment.amount),
    displayAmount: `${sign}${payment.amount} ${payment.assetCode}`,
    type: payment.direction,
  };
}

function getBalanceDisplay({
  account,
  isLoading,
  error,
  connectedPublicKey,
}: {
  account: ReturnType<typeof useStellarAccount>['account'];
  isLoading: boolean;
  error: string | null;
  connectedPublicKey?: string;
}) {
  if (!connectedPublicKey) {
    return {
      amount: 'No wallet',
      label: 'NO WALLET CONNECTED',
      status: 'Connect Freighter to load Stellar mainnet balances.',
    };
  }

  if (isLoading) {
    return {
      amount: 'Loading...',
      label: 'STELLAR MAINNET BALANCE',
      status: 'Checking Horizon account data.',
    };
  }

  if (error) {
    return {
      amount: 'Unable to load',
      label: 'STELLAR MAINNET BALANCE',
      status: error,
    };
  }

  if (account && !account.exists) {
    return {
      amount: 'Wallet not funded',
      label: 'NO STELLAR MAINNET ACCOUNT FOUND',
      status: 'Wallet connected, but no Stellar mainnet account was found. Fund this account before using real balances.',
    };
  }

  if (account) {
    return {
      amount: `XLM ${account.xlmBalance}`,
      label: 'STELLAR MAINNET BALANCE',
      status: `${account.balances.length} balance line${account.balances.length === 1 ? '' : 's'} found on Horizon.`,
    };
  }

  return {
    amount: 'No wallet',
    label: 'NO WALLET CONNECTED',
    status: 'Connect Freighter to load Stellar mainnet balances.',
  };
}

function getRecentActivityMessage({
  connectedPublicKey,
  isLoading,
  error,
}: {
  connectedPublicKey?: string;
  isLoading: boolean;
  error: string | null;
}) {
  if (!connectedPublicKey) {
    return 'Connect a wallet to load recent Stellar payments.';
  }

  if (isLoading) {
    return 'Loading recent Stellar payments...';
  }

  if (error) {
    return 'Unable to load recent Stellar payments.';
  }

  return 'No recent Stellar payments found on mainnet.';
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
  headerTitleText: {
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
  pressed: {
    opacity: 0.85,
  },
  balanceWrap: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  balanceGraphic: {
    height: 164,
    marginHorizontal: spacing.xs,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  onlineLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 106,
    borderRadius: radius.lg,
    backgroundColor: '#1E1F24',
    padding: spacing.md,
    ...shadows.card,
  },
  offlineLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 68,
    height: 84,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.card,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  wifiChipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  vaultValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  vaultValueText: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  onlineText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  offlineText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  section: {
    marginTop: spacing.xl,
  },
  emptyText: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.md,
    textAlign: 'center',
    fontWeight: '700',
  },
  list: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  trustlineContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  trustlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  trustlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#82F9A1',
  },
  trustlineText: {
    ...typography.caption,
    color: colors.surface,
    fontSize: 11,
    fontWeight: '700',
  },
  fixedNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
});
