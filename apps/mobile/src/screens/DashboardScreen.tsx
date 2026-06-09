import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Animated,
  Dimensions,
  Alert,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { useVaultBalance } from '../hooks/useVaultBalance';
import { useMockTransactions } from '../hooks/useMockTransactions';
import { LogoutConfirmationModal } from '../components/ui/LogoutConfirmationModal';
import { loadOfflinePaymentsQueue, clearOfflinePaymentsQueue, appendToOfflinePaymentsQueue } from '../services/storage/paymentQueueStorage';
import { BottomNavBar, TabType } from '../components/ui/BottomNavBar';

// Import Modular Tabs
import { HomeTab } from './dashboard/HomeTab';
import { NotificationsTab } from './dashboard/NotificationsTab';
import { ScanTab } from './dashboard/ScanTab';
import { TransactionsTab } from './dashboard/TransactionsTab';
import { ProfileTab } from './dashboard/ProfileTab';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CACHED_BALANCE_KEY = 'abotpera.cached_balance';
const TABS: TabType[] = ['home', 'notifications', 'scan', 'transactions', 'profile'];

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
  const [activeTab, setActiveTab] = useState<TabType>('home');

  // Switch animation states
  const [isTransitioning, setIsTransitioning] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
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
              cachedBalance={cachedBalance}
              queueCount={queueCount}
              syncing={syncing}
              slideAnim={slideAnim}
              isTransitioning={isTransitioning}
              mockTxs={mockTxs}
              insets={insets}
              onLogoutPress={() => setLogoutModalVisible(true)}
              onManualToggle={handleManualToggle}
              onSyncQueue={handleSyncQueue}
              onAddMockQueueItem={handleAddMockQueueItem}
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
            <TransactionsTab mockTxs={mockTxs} insets={insets} />
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
      
      {renderActiveTabContent()}

      {/* Bottom Navigation Bar */}
      <BottomNavBar activeTab={activeTab} onChangeTab={setActiveTab} />

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

