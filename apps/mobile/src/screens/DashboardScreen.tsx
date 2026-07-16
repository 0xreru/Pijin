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
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '../db/client';
import { transactions as transactionsTable, paymentQueue as paymentQueueTable } from '../db/schema';
import { eq, desc, or, and, ne } from 'drizzle-orm';
import { enqueuePayment, clearPaymentQueue } from '../db/services/paymentQueueDb';
import { clearTransactions, correctLegacyTags } from '../db/services/transactionDb';
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

// Import Offline Notice Modal
import { OfflineNoticeModal } from '../components/ui/OfflineNoticeModal';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CACHED_BALANCE_KEY = 'pijn.cached_balance';
const OFFLINE_BALANCE_KEY = 'pijn.offline_balance';
const TABS: TabType[] = ['home', 'notifications', 'scan', 'transactions', 'profile'];

export function DashboardScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { activeAccount, login, jwt } = useAuth();
  const shortId = activeAccount?.shortId || '0000';
  const publicKey = activeAccount?.stellarPublicKey || '';

  // Get live balance
  const { balancePhp, resolvedShortId, offlineBalancePhp, refresh: refreshBalance } = useVaultBalance(shortId, publicKey);

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
  const [serverOfflineBalance, setServerOfflineBalance] = useState<number>(0.00);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [readNotifIds, setReadNotifIds] = useState<string[]>([]);
  const [offlineNoticeVisible, setOfflineNoticeVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Live Queries for automatic, reactive UI updates
  const { data: rawTransactions = [] } = useLiveQuery(
    db.select()
      .from(transactionsTable)
      .where(
        and(
          ne(transactionsTable.type, 'settlement'),
          or(
            eq(transactionsTable.stellarPublicKey, publicKey),
            eq(transactionsTable.shortId, shortId)
          )
        )
      )
      .orderBy(desc(transactionsTable.createdAt))
  );

  const transactions = useMemo(() => {
    return rawTransactions.map(tx => {
      let processedTx = {
        ...tx,
        title: tx.title.replace('Paid to', 'Sent to')
      };

      // Handle legacy offline transactions that combined the fee
      const feeMatch = tx.description?.match(/with ₱([0-9.]+) processing fee/);
      if (feeMatch && tx.type === 'outgoing' && tx.tag === 'OFFLINE') {
        const feeStr = feeMatch[1];
        const feeNum = parseFloat(feeStr);
        if (!isNaN(feeNum) && feeNum > 0) {
          // Adjust the original transaction to remove the fee from the displayed amount
          processedTx.amount = tx.amount + feeNum; // e.g. -10.50 + 0.50 = -10.00
        }
      }

      return processedTx;
    });
  }, [rawTransactions]);

  const { data: pendingPayments = [] } = useLiveQuery(
    db.select().from(paymentQueueTable).where(
      and(
        eq(paymentQueueTable.synced, false),
        eq(paymentQueueTable.customerShortId, shortId)
      )
    )
  );
  const queueCount = pendingPayments.length;
  const pendingOfflineAmount = useMemo(() => {
    return pendingPayments.reduce((sum, p) => sum + p.amount, 0);
  }, [pendingPayments]);
  const offlineBalance = Math.max(0, serverOfflineBalance - pendingOfflineAmount);

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
        const [migrated, migratedV3] = await Promise.all([
          AsyncStorage.getItem('pijn.legacy_tags_migrated'),
          AsyncStorage.getItem('pijn.legacy_tags_migrated_v3')
        ]);
        if (migrated !== 'true' || migratedV3 !== 'true') {
          await correctLegacyTags();
          await AsyncStorage.setItem('pijn.legacy_tags_migrated', 'true');
          await AsyncStorage.setItem('pijn.legacy_tags_migrated_v3', 'true');
        }
        await AsyncStorage.removeItem('pijn.hide_offline_notice'); // Ensure modal appears for testing
        await ensureMigration();
        const hasReset = await AsyncStorage.getItem('pijn.initial_reset_v2');
        if (!hasReset) {
          setCachedBalance(0.00);
          await AsyncStorage.setItem(CACHED_BALANCE_KEY, '0.00');
          setServerOfflineBalance(0.00);
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
            setServerOfflineBalance(parseFloat(storedOffline));
          } else {
            setServerOfflineBalance(0.00);
            await AsyncStorage.setItem(OFFLINE_BALANCE_KEY, '0.00');
          }
          const storedReadIds = await AsyncStorage.getItem('pijn.read_notifs');
          if (storedReadIds) {
            try {
              setReadNotifIds(JSON.parse(storedReadIds));
            } catch (e) {}
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
      setServerOfflineBalance((prevOffline) => {
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

      if (shortId !== '0000' && publicKey) {
        syncService.syncTransactions(shortId, publicKey)
          .catch((err) => console.warn('[DashboardScreen] Online transfer history sync failed:', err));
      }
    });

    const subLoadOnline = DeviceEventEmitter.addListener('ON_LOAD_ONLINE_FUNDS', (amount: number) => {
      setServerOfflineBalance((prevOffline) => {
        const newOffline = Math.max(0, prevOffline - amount);
        AsyncStorage.setItem(OFFLINE_BALANCE_KEY, newOffline.toString());
        return newOffline;
      });
      setCachedBalance((prevOnline) => {
        const newOnline = prevOnline + amount;
        AsyncStorage.setItem(CACHED_BALANCE_KEY, newOnline.toString());
        return newOnline;
      });
    });

    const subSendOffline = DeviceEventEmitter.addListener('ON_SEND_MONEY_OFFLINE', (amount: number) => {
      // Handled reactively via Drizzle useLiveQuery + pendingPayments subtraction.
    });

    return () => {
      subLoad.remove();
      subSendOnline.remove();
      subLoadOnline.remove();
      subSendOffline.remove();
    };
  }, [shortId, publicKey]);

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

  // Update cached offline balance whenever live balance is fetched successfully
  useEffect(() => {
    if (offlineBalancePhp !== null) {
      setServerOfflineBalance(offlineBalancePhp);
      AsyncStorage.setItem(OFFLINE_BALANCE_KEY, offlineBalancePhp.toString());
    }
  }, [offlineBalancePhp]);

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

  // Automatically trigger smart sync when internet is detected and shortId is loaded
  useEffect(() => {
    if (hasInternet && shortId !== '0000') {
      syncService.flush()
        .then(() => {
          if (isOnline) {
             return syncService.syncTransactions(shortId, publicKey);
          }
        })
        .then(() => {
          import('../db/services/transactionDb').then(({ resolveOfflineTransactionNames }) => {
            resolveOfflineTransactionNames();
          });
          return refreshBalance();
        })
        .catch((err) => console.warn('[DashboardScreen] Auto-sync failed:', err));
    }
  }, [hasInternet, isOnline, shortId, publicKey]);

  // Handle offline notice modal
  useEffect(() => {
    if (!hasInternet) {
      AsyncStorage.getItem('pijn.hide_offline_notice').then(val => {
        if (val !== 'true') {
          setOfflineNoticeVisible(true);
        }
      });
    } else {
      setOfflineNoticeVisible(false);
    }
  }, [hasInternet]);

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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (hasInternet && shortId !== '0000') {
         await syncService.flush();
         if (isOnline) {
             await syncService.syncTransactions(shortId, publicKey);
         }
         
         const { resolveOfflineTransactionNames } = await import('../db/services/transactionDb');
         await resolveOfflineTransactionNames();
         
         await refreshBalance();
      }
    } catch (err) {
      console.warn('[DashboardScreen] Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, [hasInternet, shortId, isOnline, publicKey, refreshBalance]);

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

  const handleLoadOfflineFundsPress = useCallback(() => {
    navigation.navigate('LoadOfflineFunds', { balance: cachedBalance });
  }, [navigation, cachedBalance]);

  const handleLoadOnlineFundsPress = useCallback(() => {
    navigation.navigate('LoadOnlineFunds', { balance: offlineBalance });
  }, [navigation, offlineBalance]);

  const handleSendPress = useCallback((paymentMode: 'online' | 'offline') => {
    navigation.navigate('SendMoney', { paymentMode });
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

  // ── Memoized derived transaction lists ────────────────────────────────────
  const onlineTxs = useMemo(() => transactions.filter(t => t.tag === 'WALLET'), [transactions]);
  const offlineTxs = useMemo(() => transactions.filter(t => t.tag === 'OFFLINE'), [transactions]);

  const markNotifAsRead = useCallback((id: string) => {
    setReadNotifIds(prev => {
      if (prev.includes(id)) return prev;
      const newIds = [...prev, id];
      AsyncStorage.setItem('pijn.read_notifs', JSON.stringify(newIds)).catch(() => {});
      return newIds;
    });
  }, []);

  const markAllNotifsAsRead = useCallback(() => {
    const now = new Date().getTime();
    const unreadIds = transactions
      .filter(t => t.createdAt && (now - new Date(t.createdAt).getTime()) < 24 * 60 * 60 * 1000 && !readNotifIds.includes(t.id))
      .map(t => t.id);

    if (unreadIds.length === 0) return;

    setReadNotifIds(prev => {
      const newIds = [...prev, ...unreadIds];
      AsyncStorage.setItem('pijn.read_notifs', JSON.stringify(newIds)).catch(() => {});
      return newIds;
    });
  }, [transactions, readNotifIds]);

  const unreadCount = useMemo(() => {
    const now = new Date().getTime();
    return transactions.filter(t => 
      t.createdAt && 
      (now - new Date(t.createdAt).getTime()) < 24 * 60 * 60 * 1000 &&
      !readNotifIds.includes(t.id)
    ).length;
  }, [transactions, readNotifIds]);

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
              onManualToggle={handleManualToggle}
              onSyncQueue={handleSyncQueue}
              onAddMockQueueItem={handleAddMockQueueItem}
              onLoadOfflineFundsPress={handleLoadOfflineFundsPress}
              onLoadOnlineFundsPress={handleLoadOnlineFundsPress}
              onSendPress={handleSendPress}
              onReceivePress={handleReceivePress}
              onViewAllTransactions={handleViewAllTransactions}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          </View>

          {/* Tab 2: Notifications */}
          <View style={styles.tabPanel}>
            <NotificationsTab 
              insets={insets} 
              transactions={transactions} 
              readIds={readNotifIds}
              onMarkAsRead={markNotifAsRead}
              onMarkAllAsRead={markAllNotifsAsRead}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          </View>

          {/* Tab 3: Scan */}
          <View style={styles.tabPanel}>
            <ScanTab insets={insets} />
          </View>

          {/* Tab 4: Transactions */}
          <View style={styles.tabPanel}>
            <TransactionsTab 
              mockTxs={transactions} 
              insets={insets}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          </View>

          {/* Tab 5: Profile */}
          <View style={styles.tabPanel}>
            <ProfileTab
              shortId={shortId}
              publicKey={publicKey}
              insets={insets}
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
        unreadCount={unreadCount}
      />

      {/* Offline Notice Modal */}
      <OfflineNoticeModal
        visible={offlineNoticeVisible}
        onClose={() => setOfflineNoticeVisible(false)}
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

