import React, { useState, useEffect, useRef } from 'react';
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
import { useAuth } from '../context/AuthContext';
import { useVaultBalance } from '../hooks/useVaultBalance';
import { LogoutConfirmationModal } from '../components/ui/LogoutConfirmationModal';
import { loadTransactions } from '../services/storage/transactionStorage';
import { loadOfflinePaymentsQueue, clearOfflinePaymentsQueue, appendToOfflinePaymentsQueue } from '../services/storage/paymentQueueStorage';
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
const CACHED_BALANCE_KEY = 'abotpera.cached_balance';
const OFFLINE_BALANCE_KEY = 'abotpera.offline_balance';
const TABS: TabType[] = ['home', 'notifications', 'scan', 'transactions', 'profile'];

export function DashboardScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { activeAccount, logout } = useAuth();
  const shortId = activeAccount?.shortId || '0000';
  const publicKey = activeAccount?.stellarPublicKey || '';

  // Get live balance
  const { balancePhp, refresh: refreshBalance } = useVaultBalance(shortId, publicKey);

  // States
  const [isOnline, setIsOnline] = useState(connectionService.currentState.isOnlineMode);
  const [hasInternet, setHasInternet] = useState(connectionService.currentState.isConnected);
  const isManualOverrideRef = useRef(false);
  const [cachedBalance, setCachedBalance] = useState<number>(0.00); // Start at 0 like screenshot
  const [offlineBalance, setOfflineBalance] = useState<number>(0.00);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('home');

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
        const hasReset = await AsyncStorage.getItem('abotpera.initial_reset_v2');
        if (!hasReset) {
          setCachedBalance(25000.00);
          await AsyncStorage.setItem(CACHED_BALANCE_KEY, '25000.00');
          setOfflineBalance(0.00);
          await AsyncStorage.setItem(OFFLINE_BALANCE_KEY, '0.00');
          await AsyncStorage.setItem('abotpera.initial_reset_v2', 'true');
        } else {
          const storedBalance = await AsyncStorage.getItem(CACHED_BALANCE_KEY);
          if (storedBalance) {
            setCachedBalance(parseFloat(storedBalance));
          } else {
            setCachedBalance(25000.00);
            await AsyncStorage.setItem(CACHED_BALANCE_KEY, '25000.00');
          }
          const storedOffline = await AsyncStorage.getItem(OFFLINE_BALANCE_KEY);
          if (storedOffline) {
            setOfflineBalance(parseFloat(storedOffline));
          } else {
            setOfflineBalance(0.00);
            await AsyncStorage.setItem(OFFLINE_BALANCE_KEY, '0.00');
          }
        }
        await updateQueueCount();
        await fetchTransactions();

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
      fetchTransactions();
    });

    const subSendOnline = DeviceEventEmitter.addListener('ON_SEND_MONEY_ONLINE', (amount: number) => {
      setCachedBalance((prevOnline) => {
        const newOnline = Math.max(0, prevOnline - amount);
        AsyncStorage.setItem(CACHED_BALANCE_KEY, newOnline.toString());
        return newOnline;
      });
      fetchTransactions();
    });

    const subSendOffline = DeviceEventEmitter.addListener('ON_SEND_MONEY_OFFLINE', (amount: number) => {
      setOfflineBalance((prevOffline) => {
        const newOffline = Math.max(0, prevOffline - amount);
        AsyncStorage.setItem(OFFLINE_BALANCE_KEY, newOffline.toString());
        return newOffline;
      });
      fetchTransactions();
    });

    const subTxUpdated = DeviceEventEmitter.addListener('TRANSACTIONS_UPDATED', () => {
      fetchTransactions();
    });

    return () => {
      subLoad.remove();
      subSendOnline.remove();
      subSendOffline.remove();
      subTxUpdated.remove();
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

  const updateQueueCount = async () => {
    const queue = await loadOfflinePaymentsQueue();
    setQueueCount(queue.length);
  };

  // Switch transition handler
  const handleStateTransition = (targetOnline: boolean) => {
    setIsTransitioning(true);
    setIsOnline(targetOnline);
    AsyncStorage.setItem('abotpera.is_online', targetOnline ? 'true' : 'false');
    
    // Retain existing balance when toggling modes
    setCachedBalance((prev) => {
      const balanceToSet = prev === 0 ? 25000.00 : prev;
      AsyncStorage.setItem(CACHED_BALANCE_KEY, balanceToSet.toString());
      return balanceToSet;
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

  const handleManualToggle = (targetOnline: boolean) => {
    if (!hasInternet && targetOnline) {
      return;
    }
    isManualOverrideRef.current = true;
    connectionService.setOnlineState(targetOnline);
  };

  // Mock sync queue
  const handleSyncQueue = async () => {
    if (queueCount === 0) return;
    setSyncing(true);
    
    try {
      const queue = await loadOfflinePaymentsQueue();
      const totalAmount = queue.reduce((sum, item) => sum + item.amount, 0);

      setTimeout(async () => {
        try {
          await clearOfflinePaymentsQueue();
          setQueueCount(0);
          
          const { addTransaction } = require('../services/storage/transactionStorage');
          await addTransaction({
            title: 'Synced Offline Payments',
            subtitle: 'Today',
            amount: totalAmount,
            type: 'settlement',
            tag: 'WALLET',
            description: `Successfully synchronized and settled ${queue.length} offline voucher(s) totaling ₱${totalAmount.toFixed(2)} on the Stellar network.`,
          });

          await refreshBalance();
          setSyncing(false);
          await fetchTransactions();
          Alert.alert(
            'Sync Complete',
            'Offline payments have been broadcasted and settled on the Stellar network.'
          );
        } catch (err) {
          setSyncing(false);
          Alert.alert('Sync Failed', 'Could not establish connection to Horizon. Try again.');
        }
      }, 2000);
    } catch (err) {
      setSyncing(false);
      Alert.alert('Sync Failed', 'Could not read offline queue.');
    }
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

  const [transactions, setTransactions] = useState<any[]>([]);

  const fetchTransactions = async () => {
    try {
      const list = await loadTransactions();
      setTransactions(list);
    } catch (err) {
      console.error('Failed to load transactions:', err);
    }
  };

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
              isOnline={isOnline}
              isOnlineDisabled={!hasInternet}
              cachedBalance={cachedBalance}
              offlineBalance={offlineBalance}
              queueCount={queueCount}
              syncing={syncing}
              slideAnim={slideAnim}
              isTransitioning={isTransitioning}
              onlineTxs={transactions.filter(t => t.tag === 'WALLET')}
              offlineTxs={transactions.filter(t => t.tag === 'OFFLINE')}
              insets={insets}
              onLogoutPress={() => setLogoutModalVisible(true)}
              onManualToggle={handleManualToggle}
              onSyncQueue={handleSyncQueue}
              onAddMockQueueItem={handleAddMockQueueItem}
              onLoadOfflineFundsPress={() => {
                navigation.navigate('LoadOfflineFunds', {
                  balance: cachedBalance,
                });
              }}
              onSendPress={() => {
                navigation.navigate('SendMoney');
              }}
              onReceivePress={() => {
                navigation.navigate('GenerateQR', { mode: 'receiver' });
              }}
              onViewAllTransactions={() => setActiveTab('transactions')}
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
              onLogoutPress={() => setLogoutModalVisible(true)}
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
        onChangeTab={(tab) => {
          if (tab === 'scan') {
            navigation.navigate('ScanQR');
          } else {
            setActiveTab(tab);
          }
        }}
      />

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

