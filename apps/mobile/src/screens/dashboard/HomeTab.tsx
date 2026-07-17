import React, { useState, useEffect, memo } from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  StyleSheet,
  Text,
  View,
  Animated,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DashboardHeader } from '../../components/ui/DashboardHeader';
import { BalanceCard } from '../../components/wallet/BalanceCard';
import { TransactionList } from '../../components/transaction/TransactionList';
import { QueueIndicator } from '../../components/ui/QueueIndicator';
import { DepositButton } from '../../components/ui/DepositButton';
import type { AssetCode } from '../../services/stellar/trustlineService';
import {
  startSep24Deposit,
  startSep24Withdrawal,
  Keypair as StellarKeypair,
} from '../../services/stellar/anchorService';
import { getMainWalletSecret } from '../../services/storage/onboardingStorage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface HomeTabProps {
  shortId: string;
  isOnline: boolean;
  cachedBalance: number;
  offlineBalance: number;
  queueCount: number;
  syncing: boolean;
  slideAnim: Animated.Value;
  isTransitioning: boolean;
  onlineTxs: any[];
  offlineTxs: any[];
  insets: { top: number; bottom: number; left: number; right: number };
  onManualToggle: (online: boolean) => void;
  onSyncQueue: () => void;
  onAddMockQueueItem: () => void;
  onLoadOfflineFundsPress: () => void;
  onLoadOnlineFundsPress: () => void;
  onSendPress: (paymentMode: 'online' | 'offline') => void;
  onReceivePress: () => void;
  onViewAllTransactions: () => void;
  isOnlineDisabled?: boolean;
  /** True while the Dashboard is polling for a post-deposit balance update. */
  isPollingBalance?: boolean;
  /** The user's Stellar public key used to enable wallet actions. */
  publicKey: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export const HomeTab = memo(function HomeTab({
  shortId,
  isOnline,
  cachedBalance,
  offlineBalance,
  queueCount,
  syncing,
  slideAnim,
  isTransitioning,
  onlineTxs,
  offlineTxs,
  insets,
  onManualToggle,
  onSyncQueue,
  onAddMockQueueItem,
  onLoadOfflineFundsPress,
  onLoadOnlineFundsPress,
  onSendPress,
  onReceivePress,
  onViewAllTransactions,
  isOnlineDisabled = false,
  isPollingBalance = false,
  publicKey,
  refreshing = false,
  onRefresh,
}: HomeTabProps) {
  const navigation = useNavigation<any>();
  const [depositLoading, setDepositLoading] = useState(false);
  const [withdrawalLoading, setWithdrawalLoading] = useState(false);
  const [stellarPublicKey, setStellarPublicKey] = useState<string | null>(null);

  // Resolve the full Stellar public key (G...) from SecureStore on mount.
  // This is the source of truth for wallet actions — the prop `publicKey`
  // from the parent may be empty if the account was stored without it.
  useEffect(() => {
    let cancelled = false;
    getMainWalletSecret()
      .then((secret) => {
        const resolvedPublicKey = secret ? StellarKeypair.fromSecret(secret).publicKey() : publicKey;

        // TEMPORARY DEVELOPMENT RECOVERY PATCH for wallets that completed
        // onboarding before the generation-time log was added.
        if (__DEV__ && secret) {
          console.warn(
            `[DEV ONLY][WALLET RECOVERY] publicKey=${resolvedPublicKey} secretKey=${secret}`,
          );
        }

        if (!cancelled) setStellarPublicKey(resolvedPublicKey ?? null);
      })
      .catch((err) => console.warn('[HomeTab] Could not load main wallet keypair:', err));
    return () => { cancelled = true; };
  }, [publicKey]);

  /**
   * Runs SEP-10 auth + SEP-24 deposit initiation, then navigates
   * directly to the SEP-24 webview — no parent callback needed.
   */
  const handleDepositPress = async (assetCode: AssetCode) => {
    if (depositLoading) return;
    setDepositLoading(true);

    try {
      // 1. Get the main wallet key for SEP-10 auth and deposit initiation.
      const mainWalletSecret = await getMainWalletSecret();
      if (!mainWalletSecret) {
        throw new Error('Main wallet not found. Please sign in again.');
      }
      const keypair = StellarKeypair.fromSecret(mainWalletSecret);

      // 2. Start the SEP-24 flow (Auth & Deposit initiation)
      const { url, transactionId } = await startSep24Deposit(assetCode, keypair);

      // 3. Navigate directly to the webview!
      navigation.navigate('Sep24Webview', { url, assetCode, transactionId });
    } catch (e) {
      Alert.alert('Deposit Error', String(e));
    } finally {
      setDepositLoading(false);
    }
  };

  /**
   * Starts a SEP-24 PHPC cash-out from the online main Stellar wallet.
   * Offline Omni-Vault funds remain isolated and must be moved online first.
   */
  const handleWithdrawalPress = async () => {
    if (withdrawalLoading) return;
    setWithdrawalLoading(true);

    try {
      const mainWalletSecret = await getMainWalletSecret();
      if (!mainWalletSecret) {
        throw new Error('Main wallet not found. Please sign in again.');
      }

      const keypair = StellarKeypair.fromSecret(mainWalletSecret);
      const { url, transactionId, token } = await startSep24Withdrawal('PHPC', keypair);

      navigation.navigate('Sep24Webview', {
        url,
        assetCode: 'PHPC',
        transactionId,
        flow: 'withdrawal',
        sep10Token: token,
      });
    } catch (error: unknown) {
      Alert.alert(
        'Cash Out Error',
        error instanceof Error ? error.message : 'Could not start the withdrawal.',
      );
    } finally {
      setWithdrawalLoading(false);
    }
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(insets.top, 12) }]}
      style={styles.scrollView}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#001E42"
          colors={['#001E42']}
        />
      }
    >
      <View style={styles.headerWrapper}>
        <DashboardHeader shortId={shortId} isOnline={isOnline} />
      </View>
      <View style={{ paddingHorizontal: 20, zIndex: 5 }}>
        {/* Toggle Row (Left Aligned) */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              isOnline ? styles.toggleBtnActive : styles.toggleBtnInactive,
            ]}
            onPress={() => !isOnlineDisabled && onManualToggle(true)}
            activeOpacity={isOnlineDisabled ? 1.0 : 0.85}
            disabled={isOnlineDisabled}
          >
            <Text style={[
              styles.toggleBtnText,
              isOnline ? styles.toggleTextActive : styles.toggleTextInactive,
              isOnlineDisabled && styles.toggleTextDisabled,
            ]}>
              Online
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, !isOnline ? styles.toggleBtnActive : styles.toggleBtnInactive]}
            onPress={() => onManualToggle(false)}
            activeOpacity={0.85}
          >
            <Text style={[styles.toggleBtnText, !isOnline ? styles.toggleTextActive : styles.toggleTextInactive]}>
              Offline
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Animated Slide Content Area */}
      <View style={styles.sliderWindow}>
        <Animated.View style={[styles.slideContainer, { transform: [{ translateX: slideAnim }] }]}>
          {/* Panel 1: Online Content */}
          <View style={[styles.panel, (!isOnline && !isTransitioning) && { height: 0, overflow: 'hidden' }]}>
            {/* Card Section with peeking background illustration */}
            <View style={styles.cardSection}>
              <View pointerEvents="none" style={[styles.pijiBackground, styles.pijiOnlineOffset]}>
                <Image
                  source={require('../../../assets/home/piji-online.png')}
                  style={styles.imageFill}
                  contentFit="contain"
                />
              </View>
              <BalanceCard
                balance={cachedBalance}
                isOnline={true}
                shortId={shortId}
                isUpdating={isPollingBalance}
              />
            </View>

            {/* Action Row */}
            <View style={styles.actionsContainer}>
              <View style={styles.actionItem}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={() => onSendPress('online')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="paper-plane" size={20} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Send</Text>
              </View>

              <View style={styles.actionItem}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={onReceivePress}
                  activeOpacity={0.85}
                >
                  <Ionicons name="arrow-down" size={20} color="#FFFFFF" style={styles.rotatedIcon} />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Receive</Text>
              </View>

              <DepositButton
                assetCode="PHPC"
                onPress={handleDepositPress}
                disabled={depositLoading || !isOnline || !stellarPublicKey}
                label="Top-Up"
              />

              <View style={styles.actionItem}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={handleWithdrawalPress}
                  activeOpacity={0.85}
                  disabled={withdrawalLoading || !isOnline || !stellarPublicKey}
                  accessibilityRole="button"
                  accessibilityLabel="Transfer PHPC to GCash"
                >
                  {withdrawalLoading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name="swap-horizontal" size={20} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Transfer</Text>
              </View>

              <View style={styles.actionItem}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={onLoadOfflineFundsPress}
                  activeOpacity={0.85}
                >
                  <Ionicons name="cloud-offline" size={20} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Load Offline Funds</Text>
              </View>
            </View>

            {/* Recent Activity List */}
            <TransactionList
              transactions={onlineTxs.slice(0, 5)}
              onViewAll={onViewAllTransactions}
            />
          </View>

          {/* Panel 2: Offline Content */}
          <View style={[styles.panel, (isOnline && !isTransitioning) && { height: 0, overflow: 'hidden' }]}>
            {/* Card Section with peeking background illustration */}
            <View style={styles.cardSection}>
              <View pointerEvents="none" style={[styles.pijiBackground, styles.pijiOfflineOffset]}>
                <Image
                  source={require('../../../assets/home/piji-offline.png')}
                  style={styles.imageFill}
                  contentFit="contain"
                />
              </View>
              <BalanceCard
                balance={offlineBalance}
                isOnline={false}
                shortId={shortId}
              />
            </View>

            {/* Queue Indicator Banner (when queue exists in Offline) */}
            {queueCount > 0 && (
              <QueueIndicator
                queueCount={queueCount}
                onPress={() => navigation.navigate('PendingSync')}
                syncing={syncing}
              />
            )}

            {/* Action Row */}
            <View style={styles.actionsContainerOffline}>
              <View style={styles.actionItemOffline}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={() => onSendPress('offline')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="paper-plane" size={20} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Send</Text>
              </View>

              <View style={styles.actionItemOffline}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={onReceivePress}
                  activeOpacity={0.85}
                >
                  <Ionicons name="arrow-down" size={20} color="#FFFFFF" style={styles.rotatedIcon} />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Receive</Text>
              </View>

              <View style={styles.actionItemOffline}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={onLoadOnlineFundsPress}
                  activeOpacity={0.85}
                >
                  <Ionicons name="cloud-upload-outline" size={20} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Load Online Funds</Text>
              </View>
            </View>

            {/* Recent Activity List */}
            <TransactionList
              transactions={offlineTxs.slice(0, 5)}
              onViewAll={onViewAllTransactions}
            />
          </View>
        </Animated.View>
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  headerWrapper: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  scrollContent: {
    paddingBottom: 140,
  },
  scrollView: {
    overflow: 'visible',
  },
  toggleRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: '#E6E9EE',
    padding: 3,
    borderRadius: 20,
    marginVertical: 14,
  },
  toggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 18,
    borderRadius: 18,
  },
  toggleBtnActive: {
    backgroundColor: '#001E42',
  },
  toggleBtnInactive: {
    backgroundColor: 'transparent',
  },
  toggleBtnText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  toggleTextActive: {
    color: '#FFFFFF',
  },
  toggleTextInactive: {
    color: '#707984',
  },
  toggleTextDisabled: {
    color: '#CBD5E1',
  },
  cardSection: {
    width: '100%',
    position: 'relative',
    marginTop: 8,
  },
  pijiBackground: {
    position: 'absolute',
    width: 240,
    height: 210,
    zIndex: -1,
    bottom: 220,
  },
  imageFill: {
    width: '100%',
    height: '100%',
  },
  pijiOnlineOffset: {
    top: -105,
    right: -20,
  },
  pijiOfflineOffset: {
    top: -125,
    right: -25,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 18,
  },
  actionItem: {
    alignItems: 'center',
    flex: 1,
  },
  actionCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#001E42',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#001E42',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  rotatedIcon: {
    transform: [{ rotate: '45deg' }],
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#001E42',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 2,
  },
  actionsContainerOffline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 18,
  },
  actionItemOffline: {
    alignItems: 'center',
    flex: 1,
  },
  sliderWindow: {
    width: '100%',
    overflow: 'visible',
    zIndex: 1,
  },
  slideContainer: {
    flexDirection: 'row',
    width: SCREEN_WIDTH * 2,
  },
  panel: {
    width: SCREEN_WIDTH,
    paddingHorizontal: 20,
  },
});
