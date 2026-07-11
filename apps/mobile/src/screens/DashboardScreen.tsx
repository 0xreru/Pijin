import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Animated,
  Dimensions,
  Alert,
  StatusBar,
  DeviceEventEmitter,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureMigration } from '../services/storage/migration';
import { useAuth } from '../context/AuthContext';
import { useVaultBalance } from '../hooks/useVaultBalance';
import { LogoutConfirmationModal } from '../components/ui/LogoutConfirmationModal';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '../db/client';
import { transactions as transactionsTable, paymentQueue as paymentQueueTable } from '../db/schema';
import { eq, desc, or } from 'drizzle-orm';
import { enqueuePayment } from '../db/services/paymentQueueDb';
import { syncService } from '../services/syncService';
import { BottomNavBar, TabType } from '../components/ui/BottomNavBar';
import { connectionService } from '../services/connectionService';
import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';

// Import Modular Tabs
import { HomeTab } from './dashboard/HomeTab';
import { NotificationsTab } from './dashboard/NotificationsTab';
import { ScanTab } from './dashboard/ScanTab';
import { TransactionsTab } from './dashboard/TransactionsTab';
import { ProfileTab } from './dashboard/ProfileTab';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CACHED_BALANCE_KEY = 'pijn.cached_balance';
const OFFLINE_BALANCE_KEY = 'pijn.offline_balance';
const TABS: TabType[] = ['home', 'notifications', 'scan', 'transactions', 'profile'];

export function DashboardScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { activeAccount, login, logout, jwt } = useAuth();
  const shortId = activeAccount?.shortId || '0000';
  const publicKey = activeAccount?.stellarPublicKey || '';

  // Get live balance
  const { balancePhp, resolvedShortId, refresh: refreshBalance } = useVaultBalance(shortId, publicKey);

  // Auto-heal local account storage if shortId was missing or set to default placeholder '0000'
  useEffect(() => {
    if (
      resolvedShortId &&
      resolvedShortId !== '0000' &&
      (!activeAccount?.shortId || activeAccount.shortId === '0000') &&
      activeAccount?.stellarPublicKey &&
      jwt
    ) {
      console.log(
        `[DashboardScreen] Auto-healing local account storage: shortId missing/placeholder. ` +
        `Setting to resolved shortId: ${resolvedShortId}`
      );
      void login(activeAccount.stellarPublicKey, resolvedShortId, jwt).catch((err) => {
        console.warn('[DashboardScreen] Auto-heal login failed:', err);
      });
    }
  }, [resolvedShortId, activeAccount, login, jwt]);

  // States
  const [isOnline, setIsOnline] = useState(connectionService.currentState.isOnlineMode);
  const [hasInternet, setHasInternet] = useState(connectionService.currentState.isConnected);
  const isManualOverrideRef = useRef(false);
  const [cachedBalance, setCachedBalance] = useState<number>(0.00);
  const [isPollingBalance, setIsPollingBalance] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [offlineBalance, setOfflineBalance] = useState<number>(0.00);
  const [syncing, setSyncing] = useState(false);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('home');

  // Live Queries for automatic, reactive UI updates
  const { data: transactions = [] } = useLiveQuery(
    db.select()
      .from(transactionsTable)
      .where(
        or(
          eq(transactionsTable.stellarPublicKey, publicKey),
          eq(transactionsTable.shortId, shortId)
        )
      )
      .orderBy(desc(transactionsTable.createdAt))
  );

  const { data: pendingPayments = [] } = useLiveQuery(
    db.select().from(paymentQueueTable).where(eq(paymentQueueTable.synced, false))
  );
  const queueCount = pendingPayments.length;

  // Switch animation states
  const [isTransitioning, setIsTransitioning] = useState(false);
  const slideAnim = useRef(new Animated.Value(isOnline ? 0 : -SCREEN_WIDTH)).current;
  const tabSlideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const tabIndex = TABS.indexOf(activeTab);
    Animated.spring(tabSlideAnim, {
      toValue: -tabIndex * SCREEN_WIDTH,
      useNativeDriver: true,
      tension: 40,
      friction: 8,
    }).start();
  }, [activeTab]);

  // Load cached balance and queue count on mount
  useEffect(() => {
    const initData = async () => {
      try {
        await ensureMigration();
        const hasReset = await AsyncStorage.getItem('pijn.initial_reset_v2');
        if (!hasReset) {
          setCachedBalance(0.00);
          await AsyncStorage.setItem(CACHED_BALANCE_KEY, '0.00');
          setOfflineBalance(0.00);
          await AsyncStorage.setItem(OFFLINE_BALANCE_KEY, '0.00');
          await AsyncStorage.setItem('pijn.initial_reset_v2', 'true');
        } else {
          const storedBalance = await AsyncStorage.getItem(CACHED_BALANCE_KEY);
          if (storedBalance) {
            setCachedBalance(parseFloat(storedBalance));
          } else {
            setCachedBalance(0.00);
            await AsyncStorage.setItem(CACHED_BALANCE_KEY, '0.00');
          }
          const storedOffline = await AsyncStorage.getItem(OFFLINE_BALANCE_KEY);
          if (storedOffline) {
            setOfflineBalance(parseFloat(storedOffline));
          } else {
            setOfflineBalance(0.00);
            await AsyncStorage.setItem(OFFLINE_BALANCE_KEY, '0.00');
          }
        }

        // Initial connection check to position layout correctly on mount
        const initialOnline = connectionService.currentState.isOnlineMode;
        setIsOnline(initialOnline);
        slideAnim.setValue(initialOnline ? 0 : -SCREEN_WIDTH);
      } catch (err) {
        console.error('Failed to init dashboard cached data:', err);
      }
    };
    initData();
  }, []);

  // Listen for simulated offline loading success events and transaction events
  useEffect(() => {
    const subLoad = DeviceEventEmitter.addListener('ON_LOAD_OFFLINE_FUNDS', (amount: number) => {
      setCachedBalance((prevOnline) => {
        const newOnline = Math.max(0, prevOnline - amount);
        AsyncStorage.setItem(CACHED_BALANCE_KEY, newOnline.toString());
        return newOnline;
      });
      setOfflineBalance((prevOffline) => {
        const newOffline = prevOffline + amount;
        AsyncStorage.setItem(OFFLINE_BALANCE_KEY, newOffline.toString());
        return newOffline;
      });
    });

    const subSendOnline = DeviceEventEmitter.addListener('ON_SEND_MONEY_ONLINE', (amount: number) => {
      setCachedBalance((prevOnline) => {
        const newOnline = Math.max(0, prevOnline - amount);
        AsyncStorage.setItem(CACHED_BALANCE_KEY, newOnline.toString());
        return newOnline;
      });
    });

    const subSendOffline = DeviceEventEmitter.addListener('ON_SEND_MONEY_OFFLINE', (amount: number) => {
      setOfflineBalance((prevOffline) => {
        const newOffline = Math.max(0, prevOffline - amount);
        AsyncStorage.setItem(OFFLINE_BALANCE_KEY, newOffline.toString());
        return newOffline;
      });
    });

    return () => {
      subLoad.remove();
      subSendOnline.remove();
      subSendOffline.remove();
    };
  }, []);

  // Poll for updated balance after a SEP-24 deposit completes.
  // Strategy: re-fetch with a progressive backoff setTimeout chain (up to 15 attempts).
  // Stop early when the balance changes; alert the user if it never changes.
  const startingBalanceRef = useRef<number | null>(null);

  const startBalancePolling = useCallback((previousBalance: number | null) => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    
    setIsPollingBalance(true);
    const startBalance = previousBalance ?? cachedBalance ?? 0;
    startingBalanceRef.current = startBalance;
    
    console.log(
      `[DashboardScreen] startBalancePolling initialized | previousBalance=${previousBalance} | ` +
      `cachedBalance=${cachedBalance} | startingBalanceRef=${startBalance}`
    );
    
    let attempt = 0;
    const POLLING_DELAYS_MS = [
      4000, 4000, 5000, 5000, 6000, 6000, 7000, 7000, 8000, 8000, 9000, 9000, 10000, 10000, 10000
    ];
    const MAX_ATTEMPTS = POLLING_DELAYS_MS.length;

    const poll = async () => {
      if (!mountedRef.current) return;
      attempt += 1;
      const delay = POLLING_DELAYS_MS[attempt - 1] ?? 10000;
      console.log(
        `[DashboardScreen] Polling balance: attempt ${attempt}/${MAX_ATTEMPTS} | ` +
        `startingBalance=${startingBalanceRef.current} | currentBalance=${balancePhp} | ` +
        `nextDelay=${delay}ms`
      );

      if (!mountedRef.current) return;
      try {
        await refreshBalance();
      } catch (err) {
        if (!mountedRef.current) return;
        console.warn(`[DashboardScreen] Balance refresh failed on attempt ${attempt}:`, err);
      }

      if (!mountedRef.current) return;

      if (attempt >= MAX_ATTEMPTS) {
        console.log(`[DashboardScreen] Polling reached MAX_ATTEMPTS (${MAX_ATTEMPTS}). Polling stopped.`);
        setIsPollingBalance(false);
        pollingRef.current = null;
        Alert.alert(
          'Deposit Still Processing',
          'Your deposit is still being processed by the anchor — check back in a moment.',
        );
        return;
      }

      pollingRef.current = setTimeout(poll, delay);
    };

    // Schedule the first poll
    pollingRef.current = setTimeout(poll, POLLING_DELAYS_MS[0]);
  }, [refreshBalance, cachedBalance, balancePhp]);

  // Detect when balancePhp changes after polling starts and stop the loop.
  useEffect(() => {
    if (!isPollingBalance) return;
    
    console.log(
      `[DashboardScreen] Balance check effect | isPollingBalance=true | ` +
      `startingBalance=${startingBalanceRef.current} | currentBalance=${balancePhp}`
    );

    if (
      balancePhp !== null &&
      startingBalanceRef.current !== null &&
      balancePhp !== startingBalanceRef.current
    ) {
      console.log(
        `[DashboardScreen] Success! Balance changed from ${startingBalanceRef.current} ` +
        `to ${balancePhp}. Halting polling.`
      );
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
      setIsPollingBalance(false);

      // Trigger a sync of transaction history so it reflects immediately
      if (isOnline && shortId !== '0000') {
        syncService.syncTransactions(shortId, publicKey)
          .catch((err) => console.warn('[DashboardScreen] Post-polling transaction sync failed:', err));
      }
    }
  }, [balancePhp, isPollingBalance, isOnline, shortId, publicKey]);

  // Listen for ON_DEPOSIT_COMPLETE emitted by Sep24WebviewScreen on close.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('ON_DEPOSIT_COMPLETE', () => {
      console.log('[DashboardScreen] Received ON_DEPOSIT_COMPLETE event. Triggering startBalancePolling and sync...');
      startBalancePolling(balancePhp);
      if (isOnline && shortId !== '0000') {
        syncService.syncTransactions(shortId, publicKey)
          .catch((err) => console.warn('[DashboardScreen] ON_DEPOSIT_COMPLETE sync failed:', err));
      }
    });
    return () => sub.remove();
  }, [startBalancePolling, balancePhp, isOnline, shortId, publicKey]);

  // Cleanup poll timeout on unmount.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (pollingRef.current) {
        console.log('[DashboardScreen] Unmounting component. Cleaning up active polling timeout.');
        clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // Update cached balance whenever live balance is fetched successfully
  useEffect(() => {
    if (balancePhp !== null) {
      setCachedBalance(balancePhp);
      AsyncStorage.setItem(CACHED_BALANCE_KEY, balancePhp.toString());
    }
  }, [balancePhp]);

  // Network connection listener using RxJS connectionService
  useEffect(() => {
    const sub = connectionService.state$.subscribe((state) => {
      setHasInternet(state.isConnected);
      if (state.isOnlineMode !== isOnline) {
        handleStateTransition(state.isOnlineMode);
      }
    });
    return () => sub.unsubscribe();
  }, [isOnline]);

  // Automatically trigger smart sync when online mode is active and shortId is loaded
  useEffect(() => {
    if (isOnline && shortId !== '0000') {
      syncService.syncTransactions(shortId, publicKey)
        .then(() => refreshBalance())
        .catch((err) => console.warn('[DashboardScreen] Sync failed:', err));
    }
  }, [isOnline, shortId, publicKey]);

  // Switch transition handler
  const handleStateTransition = (targetOnline: boolean) => {
    setIsTransitioning(true);
    setIsOnline(targetOnline);
    AsyncStorage.setItem('pijn.is_online', targetOnline ? 'true' : 'false');

    // Persist the existing balance as-is when toggling modes.
    setCachedBalance((prev) => {
      AsyncStorage.setItem(CACHED_BALANCE_KEY, prev.toString());
      return prev;
    });

    Animated.spring(slideAnim, {
      toValue: targetOnline ? 0 : -SCREEN_WIDTH,
      useNativeDriver: true,
      tension: 42,
      friction: 8.5,
    }).start(() => {
      setIsTransitioning(false);
    });
  };

  const handleManualToggle = useCallback((targetOnline: boolean) => {
    if (!hasInternet && targetOnline) {
      return;
    }
    isManualOverrideRef.current = true;
    connectionService.setOnlineState(targetOnline);
  }, [hasInternet]);

  // Trigger sync queue using the new background syncService flush
  const handleSyncQueue = useCallback(async () => {
    if (queueCount === 0) return;
    setSyncing(true);
    try {
      await syncService.flush();
      await syncService.syncTransactions(shortId, publicKey);
      await refreshBalance();
      setSyncing(false);
      Alert.alert(
        'Sync Sequence Triggered',
        'The sync sequence has been executed. Check the queue status for details.'
      );
    } catch (err) {
      setSyncing(false);
      Alert.alert('Sync Failed', 'An error occurred during synchronization.');
    }
  }, [queueCount, refreshBalance, shortId, publicKey]);

  const handleAddMockQueueItem = useCallback(async () => {
    if (!isOnline) {
      const mockPayload = {
        type: 'PIJIN_OFFLINE_PAYMENT' as const,
        version: 2 as const,
        amount: 150.0,
        currency: 'PHP' as const,
        customerShortId: shortId,
        merchantShortId: '9999',
        smsBody: 'PIJIN_PAY_150_9999_MOCK',
        createdAt: new Date().toISOString(),
        expiresInMinutes: 10,
      };
      await enqueuePayment(mockPayload);
      Alert.alert('Offline Payment Queued', 'An offline payment has been generated and queued.');
    } else {
      Alert.alert('Load Offline Funds', 'Move funds to offline vault for network-free usage.');
    }
  }, [isOnline, shortId]);

  // ── Stable callback refs for tab props ────────────────────────────────────
  const handleLogoutPress = useCallback(() => setLogoutModalVisible(true), []);

  const handleLoadOfflineFundsPress = useCallback(() => {
    navigation.navigate('LoadOfflineFunds', { balance: cachedBalance });
  }, [navigation, cachedBalance]);

  const handleSendPress = useCallback(() => {
    navigation.navigate('SendMoney');
  }, [navigation]);

  const handleReceivePress = useCallback(() => {
    navigation.navigate('GenerateQR', { mode: 'receiver' });
  }, [navigation]);

  const handleViewAllTransactions = useCallback(() => setActiveTab('transactions'), []);

  const handleChangeTab = useCallback((tab: TabType) => {
    if (tab === 'scan') {
      navigation.navigate('ScanQR');
    } else {
      setActiveTab(tab);
    }
  }, [navigation]);

  const handleLogoutConfirm = useCallback(async () => {
    setLogoutModalVisible(false);
    await logout();
  }, [logout]);

  const handleLogoutCancel = useCallback(() => setLogoutModalVisible(false), []);

  // ── Memoized derived transaction lists ────────────────────────────────────
  const onlineTxs = useMemo(() => transactions.filter(t => t.tag === 'WALLET'), [transactions]);
  const offlineTxs = useMemo(() => transactions.filter(t => t.tag === 'OFFLINE'), [transactions]);

  const renderActiveTabContent = () => {
    return (
      <View style={styles.tabSliderWindow}>
        <Animated.View
          style={[
            styles.tabSlideContainer,
            {
              transform: [{ translateX: tabSlideAnim }],
            },
          ]}
        >
          {/* Tab 1: Home */}
          <View style={styles.tabPanel}>
            <HomeTab
              shortId={shortId}
              publicKey={publicKey}
              isOnline={isOnline}
              isOnlineDisabled={!hasInternet}
              cachedBalance={cachedBalance}
              offlineBalance={offlineBalance}
              queueCount={queueCount}
              syncing={syncing}
              slideAnim={slideAnim}
              isTransitioning={isTransitioning}
              onlineTxs={onlineTxs}
              offlineTxs={offlineTxs}
              insets={insets}
              isPollingBalance={isPollingBalance}
              onLogoutPress={handleLogoutPress}
              onManualToggle={handleManualToggle}
              onSyncQueue={handleSyncQueue}
              onAddMockQueueItem={handleAddMockQueueItem}
              onLoadOfflineFundsPress={handleLoadOfflineFundsPress}
              onSendPress={handleSendPress}
              onReceivePress={handleReceivePress}
              onViewAllTransactions={handleViewAllTransactions}
            />
          </View>

          {/* Tab 2: Notifications */}
          <View style={styles.tabPanel}>
            <NotificationsTab insets={insets} />
          </View>

          {/* Tab 3: Scan */}
          <View style={styles.tabPanel}>
            <ScanTab insets={insets} />
          </View>

          {/* Tab 4: Transactions */}
          <View style={styles.tabPanel}>
            <TransactionsTab mockTxs={transactions} insets={insets} />
          </View>

          {/* Tab 5: Profile */}
          <View style={styles.tabPanel}>
            <ProfileTab
              shortId={shortId}
              publicKey={publicKey}
              insets={insets}
              onLogoutPress={handleLogoutPress}
            />
          </View>
        </Animated.View>
      </View>
    );
  };


  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      
      <ConnectionWatcher
        currentMode={isOnline ? 'online' : 'offline'}
        onOfflineRedirect={() => connectionService.setOnlineState(false)}
      />

      {renderActiveTabContent()}

      {/* Bottom Navigation Bar */}
      <BottomNavBar
        activeTab={activeTab}
        onChangeTab={handleChangeTab}
      />

      {/* Logout Modal */}
      <LogoutConfirmationModal
        visible={logoutModalVisible}
        onConfirm={handleLogoutConfirm}
        onCancel={handleLogoutCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#EFF1F5', // Off-white/light grey background from screenshots
  },
  tabSliderWindow: {
    flex: 1,
    overflow: 'hidden',
  },
  tabSlideContainer: {
    flexDirection: 'row',
    width: SCREEN_WIDTH * 5,
    flex: 1,
  },
  tabPanel: {
    width: SCREEN_WIDTH,
    flex: 1,
  },
});

