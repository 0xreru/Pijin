import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Animated,
  TouchableOpacity,
  Image,
  Dimensions,
  ScrollView,
  Alert,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { useVaultBalance } from '../hooks/useVaultBalance';
import { useMockTransactions } from '../hooks/useMockTransactions';
import { BalanceCard } from '../components/wallet/BalanceCard';
import { TransactionList } from '../components/transaction/TransactionList';
import { DashboardHeader } from '../components/ui/DashboardHeader';
import { LogoutConfirmationModal } from '../components/ui/LogoutConfirmationModal';
import { QueueIndicator } from '../components/ui/QueueIndicator';
import { loadOfflinePaymentsQueue, clearOfflinePaymentsQueue, appendToOfflinePaymentsQueue } from '../services/storage/paymentQueueStorage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CACHED_BALANCE_KEY = 'abotpera.cached_balance';

export function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { activeAccount, logout } = useAuth();
  const shortId = activeAccount?.shortId || '0000';
  const publicKey = activeAccount?.stellarPublicKey || '';

  // Get live balance
  const { balancePhp, refresh: refreshBalance } = useVaultBalance(shortId, publicKey);

  // States
  const [isOnline, setIsOnline] = useState(true);
  const isManualOverrideRef = useRef(false);
  const [cachedBalance, setCachedBalance] = useState<number>(0.00); // Start at 0 like screenshot
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);

  // Switch animation states
  const [isTransitioning, setIsTransitioning] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Load cached balance and queue count on mount
  useEffect(() => {
    const initData = async () => {
      try {
        const storedBalance = await AsyncStorage.getItem(CACHED_BALANCE_KEY);
        if (storedBalance) {
          setCachedBalance(parseFloat(storedBalance));
        } else {
          setCachedBalance(0.00);
        }
        await updateQueueCount();

        // Initial connection check to position layout correctly on mount
        const state = await NetInfo.fetch();
        if (state.isConnected === false) {
          setIsOnline(false);
          setCachedBalance(20000.00);
          slideAnim.setValue(-SCREEN_WIDTH);
        }
      } catch (err) {
        console.error('Failed to init dashboard cached data:', err);
      }
    };
    initData();
  }, []);

  // Update cached balance whenever live balance is fetched successfully
  useEffect(() => {
    if (balancePhp !== null) {
      setCachedBalance(balancePhp);
      AsyncStorage.setItem(CACHED_BALANCE_KEY, balancePhp.toString());
    }
  }, [balancePhp]);

  // Network connection listener
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected !== null && !isManualOverrideRef.current) {
        if (state.isConnected !== isOnline) {
          handleStateTransition(state.isConnected);
        }
      }
    });
    return () => unsubscribe();
  }, [isOnline]);

  const updateQueueCount = async () => {
    const queue = await loadOfflinePaymentsQueue();
    setQueueCount(queue.length);
  };

  // Switch transition handler
  const handleStateTransition = (targetOnline: boolean) => {
    setIsTransitioning(true);
    setIsOnline(targetOnline);
    if (targetOnline) {
      setCachedBalance(0.00);
    } else {
      setCachedBalance(20000.00);
    }

    Animated.spring(slideAnim, {
      toValue: targetOnline ? 0 : -SCREEN_WIDTH,
      useNativeDriver: true,
      tension: 42,
      friction: 8.5,
    }).start(() => {
      setIsTransitioning(false);
    });
  };

  const handleManualToggle = (targetOnline: boolean) => {
    isManualOverrideRef.current = true;
    handleStateTransition(targetOnline);
  };

  // Mock sync queue
  const handleSyncQueue = async () => {
    if (queueCount === 0) return;
    setSyncing(true);
    
    setTimeout(async () => {
      try {
        await clearOfflinePaymentsQueue();
        setQueueCount(0);
        await refreshBalance();
        setSyncing(false);
        Alert.alert(
          'Sync Complete',
          'Offline payments have been broadcasted and settled on the Stellar network.'
        );
      } catch (err) {
        setSyncing(false);
        Alert.alert('Sync Failed', 'Could not establish connection to Horizon. Try again.');
      }
    }, 2000);
  };

  const handleAddMockQueueItem = async () => {
    if (!isOnline) {
      const mockPayload = {
        type: 'ABOTPERA_OFFLINE_PAYMENT' as const,
        version: 2 as const,
        amount: 150.0,
        currency: 'PHP' as const,
        customerShortId: shortId,
        merchantShortId: '9999',
        smsBody: 'ABOTPERA_PAY_150_9999_MOCK',
        createdAt: new Date().toISOString(),
        expiresInMinutes: 10,
      };
      await appendToOfflinePaymentsQueue(mockPayload);
      await updateQueueCount();
      Alert.alert('Offline Payment Queued', 'An offline payment has been generated and queued.');
    } else {
      Alert.alert('Load Offline Funds', 'Move funds to offline vault for network-free usage.');
    }
  };

  // Mock Transactions: Online shows activity, Offline shows empty state
  const mockTxs = useMockTransactions('all');

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(insets.top, 12) }]}
        style={styles.scrollView}
      >
        <View style={styles.headerWrapper}>
          <DashboardHeader shortId={shortId} isOnline={isOnline} onLogoutPress={() => setLogoutModalVisible(true)} />
        </View>
        <View style={{ paddingHorizontal: 20, zIndex: 5 }}>
          {/* Toggle Row (Left Aligned) */}
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, isOnline ? styles.toggleBtnActive : styles.toggleBtnInactive]}
              onPress={() => handleManualToggle(true)}
              activeOpacity={0.85}
            >
              <Text style={[styles.toggleBtnText, isOnline ? styles.toggleTextActive : styles.toggleTextInactive]}>
                Online
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, !isOnline ? styles.toggleBtnActive : styles.toggleBtnInactive]}
              onPress={() => handleManualToggle(false)}
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
                    source={require('../../assets/home/piji-online.png')}
                    style={styles.imageFill}
                    resizeMode="contain"
                  />
                </View>
                <BalanceCard
                  balance={cachedBalance}
                  isOnline={true}
                  shortId={shortId}
                />
              </View>

              {/* Action Row */}
              <View style={styles.actionsContainer}>
                <View style={styles.actionItem}>
                  <TouchableOpacity
                    style={styles.actionCircle}
                    onPress={() => Alert.alert('Send', 'Navigate to send transaction screen.')}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="paper-plane" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                  <Text style={styles.actionLabel}>Send</Text>
                </View>

                <View style={styles.actionItem}>
                  <TouchableOpacity
                    style={styles.actionCircle}
                    onPress={() => Alert.alert('Receive', 'Show wallet public QR code.')}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="arrow-down" size={20} color="#FFFFFF" style={styles.rotatedIcon} />
                  </TouchableOpacity>
                  <Text style={styles.actionLabel}>Receive</Text>
                </View>

                <View style={styles.actionItem}>
                  <TouchableOpacity
                    style={styles.actionCircle}
                    onPress={() => Alert.alert('Cash-In', 'Open payment gateways to add funds.')}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="card" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                  <Text style={styles.actionLabel}>Cash-In</Text>
                </View>

                <View style={styles.actionItem}>
                  <TouchableOpacity
                    style={styles.actionCircle}
                    onPress={handleAddMockQueueItem}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="cloud-offline" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                  <Text style={styles.actionLabel}>Load Offline Funds</Text>
                </View>
              </View>

              {/* Recent Activity List */}
              <TransactionList
                transactions={mockTxs}
                onViewAll={() => Alert.alert('View All', 'Show complete transaction history.')}
              />
            </View>

            {/* Panel 2: Offline Content */}
            <View style={[styles.panel, (isOnline && !isTransitioning) && { height: 0, overflow: 'hidden' }]}>
              {/* Card Section with peeking background illustration */}
              <View style={styles.cardSection}>
                <View pointerEvents="none" style={[styles.pijiBackground, styles.pijiOfflineOffset]}>
                  <Image
                    source={require('../../assets/home/piji-offline.png')}
                    style={styles.imageFill}
                    resizeMode="contain"
                  />
                </View>
                <BalanceCard
                  balance={cachedBalance}
                  isOnline={false}
                  shortId={shortId}
                />
              </View>

              {/* Queue Indicator Banner (when queue exists in Offline) */}
              {queueCount > 0 && (
                <QueueIndicator
                  queueCount={queueCount}
                  onSyncPress={handleSyncQueue}
                  syncing={syncing}
                />
              )}

              {/* Action Row */}
              <View style={styles.actionsContainerOffline}>
                <View style={styles.actionItemOffline}>
                  <TouchableOpacity
                    style={styles.actionCircle}
                    onPress={handleAddMockQueueItem}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="paper-plane" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                  <Text style={styles.actionLabel}>Send</Text>
                </View>

                <View style={styles.actionItemOffline}>
                  <TouchableOpacity
                    style={styles.actionCircle}
                    onPress={() => Alert.alert('Receive', 'Show offline payment receive voucher.')}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="arrow-down" size={20} color="#FFFFFF" style={styles.rotatedIcon} />
                  </TouchableOpacity>
                  <Text style={styles.actionLabel}>Receive</Text>
                </View>
              </View>

              {/* Recent Activity List */}
              <TransactionList
                transactions={[]}
                onViewAll={() => Alert.alert('View All', 'Show complete transaction history.')}
              />
            </View>
          </Animated.View>
        </View>
      </ScrollView>

      {/* Logout Modal */}
      <LogoutConfirmationModal
        visible={logoutModalVisible}
        onConfirm={async () => {
          setLogoutModalVisible(false);
          await logout();
        }}
        onCancel={() => setLogoutModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#EFF1F5', // Off-white/light grey background from screenshots
  },
  headerWrapper: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  scrollContent: {
    paddingBottom: 40,
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
    right: -25,
  },
  pijiOfflineOffset: {
    top: -125,
    right: -35,
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
    fontSize: 11,
    fontWeight: '600',
    color: '#001E42',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  actionsContainerOffline: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 50,
    width: '100%',
    paddingVertical: 18,
  },
  actionItemOffline: {
    alignItems: 'center',
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

