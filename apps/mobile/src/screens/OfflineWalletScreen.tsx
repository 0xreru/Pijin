import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../components/ui/AppButton';
import { BottomNavBar, BottomTab } from '../components/ui/BottomNavBar';
import { ScreenContainer } from '../components/ui/ScreenContainer';
import { radius } from '../constants/radius';
import { spacing } from '../constants/spacing';
import { colors, shadows } from '../constants/theme';
import { typography } from '../constants/typography';
import { useStellarAccount } from '../hooks/useStellarAccount';
import { useVaultBalance } from '../hooks/useVaultBalance';

type OfflineWalletScreenProps = {
  bottomTab?: BottomTab;
  connectedPublicKey?: string;
  shortId?: string;
  onBottomTabPress?: (tab: BottomTab) => void;
  onPrepareOfflineCash?: () => void;
  onLogout?: () => void;
};

export function OfflineWalletScreen({
  bottomTab = 'Wallet',
  connectedPublicKey,
  shortId,
  onBottomTabPress,
  onPrepareOfflineCash,
  onLogout,
}: OfflineWalletScreenProps) {
  const { account, isLoading, error } = useStellarAccount(connectedPublicKey);
  const vault = useVaultBalance(shortId, connectedPublicKey);
  const xlmStatus = getXlmStatus({ connectedPublicKey, account, isLoading, error });

  return (
    <ScreenContainer scroll={false} contentStyle={styles.screen}>
      <View style={styles.root}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <WalletHeader connectedPublicKey={connectedPublicKey} shortId={shortId} onLogout={onLogout} />

          <View style={styles.titleBlock}>
            <Text style={styles.greeting}>OFFLINE VAULT</Text>
            <Text style={styles.title}>Secure Storage</Text>
            <Text style={styles.realBalanceText}>{xlmStatus}</Text>
          </View>

          <View style={styles.balanceWrap}>
            {/* Highly visual physical vault card */}
            <View style={styles.vaultCard}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <Ionicons name="shield-checkmark" size={16} color="#F2C94C" />
                  <Text style={styles.cardHeaderTitle}>SECURE HARDWARE STORAGE</Text>
                </View>
                <Ionicons name="wifi" size={16} color="rgba(255, 255, 255, 0.4)" style={{ transform: [{ rotate: '90deg' }] }} />
              </View>

              <View style={styles.chipRow}>
                <View style={styles.metalChip}>
                  <Ionicons name="hardware-chip-outline" size={24} color="#E0E0E0" />
                </View>
                <View style={styles.vaultBadgeCapsule}>
                  <Text style={styles.vaultBadgeText}>SOROBAN ESCROW</Text>
                </View>
              </View>

              <View style={styles.balanceContent}>
                <Text style={styles.vaultLabel}>LOCKED OFFLINE VAULT BALANCE</Text>
                <Text style={styles.vaultAmount}>
                  {vault.balancePhp !== null
                    ? `✦${vault.balancePhp.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : vault.isLoading
                      ? 'Checking...'
                      : '✦0.00'}
                </Text>
                <Text style={styles.vaultStatus}>
                  {vault.error ?? 'Offline cryptographic key verification enabled'}
                </Text>
              </View>
            </View>
          </View>

          {vault.balancePhp === 0 || vault.balancePhp === null ? (
            <View style={styles.emptyState}>
              <Ionicons name="lock-closed" size={32} color={colors.muted} />
              <Text style={styles.emptyTitle}>No offline funds prepared yet</Text>
              <Text style={styles.emptyText}>Lock funds to make them available for offline payments.</Text>
            </View>
          ) : null}

          <AppButton
            title="PREPARE OFFLINE CASH"
            onPress={onPrepareOfflineCash}
            variant="light"
            compact
            icon={<Ionicons name="cash-outline" size={17} color={colors.ink} />}
            style={styles.prepareButton}
          />
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
          <Ionicons name="shield-checkmark-outline" size={22} color={colors.ink} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitleText}>Offline Wallet</Text>
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

function getXlmStatus({
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
    return 'Connect a wallet to prepare offline funds.';
  }

  if (isLoading) {
    return 'Loading Stellar mainnet balance...';
  }

  if (error) {
    return 'Unable to load real Stellar balance.';
  }

  if (account && !account.exists) {
    return 'Wallet connected, but no Stellar mainnet account was found.';
  }

  if (account) {
    return `Stellar mainnet balance: XLM ${account.xlmBalance}`;
  }

  return 'Connect a wallet to prepare offline funds.';
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
  titleBlock: {
    marginTop: spacing.sm,
  },
  greeting: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    ...typography.screenTitle,
    color: colors.ink,
    marginTop: spacing.xs,
    fontSize: 28,
    fontWeight: '900',
  },
  realBalanceText: {
    ...typography.caption,
    color: colors.mutedDark,
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  balanceWrap: {
    marginTop: spacing.lg,
  },
  vaultCard: {
    backgroundColor: '#0F1014',
    borderRadius: radius.xl,
    padding: spacing.xl,
    minHeight: 220,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cardHeaderTitle: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  metalChip: {
    width: 44,
    height: 32,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  vaultBadgeCapsule: {
    backgroundColor: 'rgba(242, 201, 76, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(242, 201, 76, 0.25)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  vaultBadgeText: {
    color: '#F2C94C',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  balanceContent: {
    marginTop: spacing.md,
  },
  vaultLabel: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  vaultAmount: {
    color: colors.surface,
    fontSize: 36,
    fontWeight: '900',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  vaultStatus: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
  },
  prepareButton: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  emptyState: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    padding: spacing.xl,
    marginTop: spacing.lg,
    ...shadows.soft,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
    textAlign: 'center',
    fontWeight: '700',
  },
});
