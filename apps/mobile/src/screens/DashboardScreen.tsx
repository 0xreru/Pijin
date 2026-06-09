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
import { BottomNavBar, TabType } from '../components/ui/BottomNavBar';

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
  const [activeNotificationFilter, setActiveNotificationFilter] = useState<'all' | 'transactions' | 'updates' | 'unread'>('all');

  // Switch animation states
  const [isTransitioning, setIsTransitioning] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const tabSlideAnim = useRef(new Animated.Value(0)).current;
  const notifSlideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const tabIndex = TABS.indexOf(activeTab);
    Animated.spring(tabSlideAnim, {
      toValue: -tabIndex * SCREEN_WIDTH,
      useNativeDriver: true,
      tension: 40,
      friction: 8,
    }).start();
  }, [activeTab]);

  useEffect(() => {
    const filterIndex = ['all', 'transactions', 'updates', 'unread'].indexOf(activeNotificationFilter);
    Animated.spring(notifSlideAnim, {
      toValue: -filterIndex * (SCREEN_WIDTH - 40),
      useNativeDriver: true,
      tension: 45,
      friction: 8.5,
    }).start();
  }, [activeNotificationFilter]);

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

  const renderNotifications = () => {
    const NOTIF_SCREEN_WIDTH = SCREEN_WIDTH - 40;

    const mockNotifs = [
      { id: '1', title: 'Transfer Received from Maria', body: 'Maria S. sent you ', amount: '₱2,000', time: '5m ago', type: 'transaction', unread: true, initials: 'MS' },
      { id: '2', title: 'Transfer Received from Juan', body: 'Juan D. sent you ', amount: '₱1,500', time: '15m ago', type: 'transaction', unread: false, initials: 'JD' },
      { id: '3', title: 'Transfer Received from Sophia', body: 'Sophia L. sent you ', amount: '₱350', time: '1h ago', type: 'transaction', unread: true, initials: 'SL' },
      { id: '4', title: 'Transfer Received from Alexander', body: 'Alexander M. sent you ', amount: '₱5,000', time: '3h ago', type: 'transaction', unread: false, initials: 'AM' },
      { id: '5', title: 'Transfer Received from Isabella', body: 'Isabella C. sent you ', amount: '₱800', time: '1d ago', type: 'transaction', unread: false, initials: 'IC' },
    ];

    const handleFilterChange = (filter: 'all' | 'transactions' | 'updates' | 'unread') => {
      setActiveNotificationFilter(filter);
    };

    const renderFilterChip = (filter: 'all' | 'transactions' | 'updates' | 'unread', label: string) => {
      const isActive = activeNotificationFilter === filter;
      return (
        <TouchableOpacity
          key={filter}
          style={[styles.notifChip, isActive ? styles.notifChipActive : styles.notifChipInactive]}
          onPress={() => handleFilterChange(filter)}
          activeOpacity={0.8}
        >
          <Text style={[styles.notifChipText, isActive ? styles.notifChipTextActive : styles.notifChipTextInactive]}>
            {label}
          </Text>
        </TouchableOpacity>
      );
    };

    const renderNotifList = (items: typeof mockNotifs) => {
      if (items.length > 0) {
        return (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
            style={{ flex: 1 }}
          >
            <View style={styles.notifList}>
              {items.map((item, index) => (
                <View key={item.id} style={styles.notifItemContainer}>
                  <View style={styles.notifRow}>
                    {/* Circle Badge with Initials */}
                    <View style={styles.notifBadgeCircle}>
                      <Text style={styles.notifBadgeText}>{item.initials}</Text>
                    </View>
                    
                    {/* Content */}
                    <View style={styles.notifContentCol}>
                      <Text style={styles.notifItemTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.notifItemBody}>
                        {item.body}
                        <Text style={styles.notifAmountText}>{item.amount}</Text>
                      </Text>
                    </View>

                    {/* Time & Unread Indicator */}
                    <View style={styles.notifRightCol}>
                      <Text style={styles.notifTimeText}>{item.time}</Text>
                      {item.unread && (
                        <View style={styles.unreadDot} />
                      )}
                    </View>
                  </View>

                  {/* Horizontal line separator */}
                  {index < items.length - 1 && (
                    <View style={styles.notifSeparator} />
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      } else {
        return (
          /* Empty State View */
          <View style={styles.emptyStateContainer}>
            <Image
              source={require('../../assets/notifications/piji-notif.png')}
              style={styles.emptyStateImage}
              resizeMode="contain"
            />
            <Text style={styles.emptyStateText}>No notifications found.</Text>
          </View>
        );
      }
    };

    return (
      <View style={[styles.tabContentContainer, { paddingTop: Math.max(insets.top, 20), flex: 1 }]}>
        {/* Header with bell icon outline */}
        <View style={styles.notifHeaderRow}>
          <Ionicons name="notifications-outline" size={28} color="#001E42" />
          <Text style={styles.notifHeaderTitle}>Notifications</Text>
        </View>

        {/* Filter bar */}
        <View style={styles.notifFilterContainer}>
          <Text style={styles.notifFilterLabel}>Filter</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.notifFilterScroll}
          >
            {renderFilterChip('all', 'All')}
            {renderFilterChip('transactions', 'Transactions')}
            {renderFilterChip('updates', 'Updates')}
            {renderFilterChip('unread', 'Unread')}
          </ScrollView>
        </View>

        {/* Latest Label & Horizontal Slide Container */}
        <Text style={styles.latestTitle}>Latest</Text>

        <View style={{ flex: 1, overflow: 'hidden' }}>
          <Animated.View
            style={{
              flexDirection: 'row',
              width: NOTIF_SCREEN_WIDTH * 4,
              flex: 1,
              transform: [{ translateX: notifSlideAnim }],
            }}
          >
            {/* Panel 0: All */}
            <View style={{ width: NOTIF_SCREEN_WIDTH, flex: 1 }}>
              {renderNotifList(mockNotifs.filter(item => item.type === 'transaction'))}
            </View>

            {/* Panel 1: Transactions */}
            <View style={{ width: NOTIF_SCREEN_WIDTH, flex: 1 }}>
              {renderNotifList(mockNotifs.filter(item => item.type === 'transaction'))}
            </View>

            {/* Panel 2: Updates */}
            <View style={{ width: NOTIF_SCREEN_WIDTH, flex: 1 }}>
              {renderNotifList([])}
            </View>

            {/* Panel 3: Unread */}
            <View style={{ width: NOTIF_SCREEN_WIDTH, flex: 1 }}>
              {renderNotifList(mockNotifs.filter(item => item.type === 'transaction' && item.unread))}
            </View>
          </Animated.View>
        </View>
      </View>
    );
  };

  const renderScan = () => {
    return (
      <View style={[styles.scannerContainer, { paddingTop: Math.max(insets.top, 20) }]}>
        <Text style={styles.tabHeaderTitleCentered}>Scan QR Code</Text>
        <Text style={styles.scannerSubtitle}>Position the QR code within the frame to pay offline</Text>
        
        {/* Mock Scanner View Finder */}
        <View style={styles.viewFinderContainer}>
          <View style={styles.viewFinder}>
            {/* Corner Markers */}
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
            
            <Ionicons name="scan-outline" size={80} color="rgba(255, 255, 255, 0.3)" />
            
            {/* Animated Scanning Red Line */}
            <View style={styles.scannerLaser} />
          </View>
        </View>

        <TouchableOpacity 
          style={styles.simulateScanBtn}
          onPress={() => Alert.alert('Scan Simulation', 'In the final app, this opens the camera to scan a merchant payment QR code.')}
        >
          <Ionicons name="camera" size={20} color="#FFFFFF" />
          <Text style={styles.simulateScanBtnText}>Simulate Camera Scan</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderTransactions = () => {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.tabContentContainer, { paddingTop: Math.max(insets.top, 20) }]}
      >
        <Text style={styles.tabHeaderTitle}>Transactions</Text>
        
        {/* Mini Tab Filter Bar */}
        <View style={styles.transactionsFilterBar}>
          <TouchableOpacity style={[styles.filterChip, styles.filterChipActive]}>
            <Text style={[styles.filterChipText, styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterChip}>
            <Text style={styles.filterChipText}>Sent</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterChip}>
            <Text style={styles.filterChipText}>Received</Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 10 }}>
          <TransactionList
            transactions={mockTxs}
            onViewAll={() => {}}
          />
        </View>
      </ScrollView>
    );
  };

  const renderProfile = () => {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.tabContentContainer, { paddingTop: Math.max(insets.top, 20) }]}
      >
        <Text style={styles.tabHeaderTitle}>Profile</Text>
        
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.profileAvatarContainer}>
            <Ionicons name="person-circle" size={60} color="#001E42" />
          </View>
          <Text style={styles.profileName}>Erickson Guhilde</Text>
          <Text style={styles.profileShortId}>Wallet ID: #{shortId}</Text>
          
          <View style={styles.pubKeyContainer}>
            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.pubKeyText}>
              {publicKey || 'Not connected'}
            </Text>
            <TouchableOpacity 
              style={styles.copyBtn} 
              onPress={() => Alert.alert('Copied', 'Public Key copied to clipboard!')}
            >
              <Ionicons name="copy-outline" size={16} color="#4B5563" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Menu List */}
        <View style={styles.menuContainer}>
          <TouchableOpacity style={styles.menuItem} onPress={() => Alert.alert('Feature Offline', 'Available in full release.')}>
            <View style={styles.menuItemLeft}>
              <Ionicons name="settings-outline" size={20} color="#001E42" />
              <Text style={styles.menuItemText}>Account Settings</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => Alert.alert('Vault Settings', 'Configure offline limit.')}>
            <View style={styles.menuItemLeft}>
              <Ionicons name="wallet-outline" size={20} color="#001E42" />
              <Text style={styles.menuItemText}>Vault Settings</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => Alert.alert('PIN Setting', 'Change app authorization PIN.')}>
            <View style={styles.menuItemLeft}>
              <Ionicons name="lock-closed-outline" size={20} color="#001E42" />
              <Text style={styles.menuItemText}>Change PIN</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.menuItem, styles.menuItemLogout]} onPress={() => setLogoutModalVisible(true)}>
            <View style={styles.menuItemLeft}>
              <Ionicons name="log-out-outline" size={20} color="#DC2626" />
              <Text style={[styles.menuItemText, styles.logoutText]}>Log Out</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#DC2626" />
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
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
          </View>

          {/* Tab 2: Notifications */}
          <View style={styles.tabPanel}>{renderNotifications()}</View>

          {/* Tab 3: Scan */}
          <View style={styles.tabPanel}>{renderScan()}</View>

          {/* Tab 4: Transactions */}
          <View style={styles.tabPanel}>{renderTransactions()}</View>

          {/* Tab 5: Profile */}
          <View style={styles.tabPanel}>{renderProfile()}</View>
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
  headerWrapper: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  scrollContent: {
    paddingBottom: 110,
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
    right: -20,
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
  tabContentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 110,
  },
  tabHeaderTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#001E42',
    marginBottom: 20,
  },
  tabHeaderTitleCentered: {
    fontSize: 24,
    fontWeight: '800',
    color: '#001E42',
    marginBottom: 10,
    textAlign: 'center',
  },
  notifHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  notifHeaderTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#001E42',
  },
  notifFilterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  notifFilterLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginRight: 12,
  },
  notifFilterScroll: {
    gap: 8,
    paddingRight: 20,
  },
  notifChip: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifChipActive: {
    backgroundColor: '#001E42',
    borderColor: '#001E42',
  },
  notifChipInactive: {
    backgroundColor: 'transparent',
    borderColor: '#D1D5DB',
  },
  notifChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  notifChipTextActive: {
    color: '#FFFFFF',
  },
  notifChipTextInactive: {
    color: '#1F2937',
  },
  latestTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  notifList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  notifItemContainer: {
    width: '100%',
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  notifBadgeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#001E42',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  notifBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  notifContentCol: {
    flex: 1,
    marginRight: 8,
  },
  notifItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#001E42',
    marginBottom: 2,
  },
  notifItemBody: {
    fontSize: 13,
    color: '#4B5563',
  },
  notifAmountText: {
    fontWeight: '800',
    color: '#001E42',
  },
  notifRightCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  notifTimeText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3B82F6',
  },
  notifSeparator: {
    height: 1,
    backgroundColor: '#E6E9EE',
    width: '100%',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateImage: {
    width: 260,
    height: 200,
    marginBottom: 20,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#707984',
    textAlign: 'center',
  },
  scannerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: 110,
  },
  scannerSubtitle: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 30,
    paddingHorizontal: 20,
  },
  viewFinderContainer: {
    width: 250,
    height: 250,
    backgroundColor: '#000000',
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
    borderWidth: 2,
    borderColor: '#374151',
  },
  viewFinder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#3B82F6',
  },
  topLeft: {
    top: 20,
    left: 20,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: 20,
    right: 20,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: 20,
    left: 20,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: 20,
    right: 20,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  scannerLaser: {
    position: 'absolute',
    left: 20,
    right: 20,
    height: 2,
    backgroundColor: '#3B82F6',
    top: '50%',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  simulateScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#001E42',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  simulateScanBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  transactionsFilterBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: '#E6E9EE',
  },
  filterChipActive: {
    backgroundColor: '#001E42',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#707984',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  profileAvatarContainer: {
    marginBottom: 12,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#001E42',
    marginBottom: 4,
  },
  profileShortId: {
    fontSize: 13,
    color: '#707984',
    fontWeight: '600',
    marginBottom: 16,
  },
  pubKeyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    maxWidth: '100%',
  },
  pubKeyText: {
    fontSize: 12,
    color: '#4B5563',
    fontFamily: 'monospace',
    flex: 1,
    marginRight: 8,
  },
  copyBtn: {
    padding: 2,
  },
  menuContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  menuItemLogout: {
    borderBottomWidth: 0,
  },
  logoutText: {
    color: '#DC2626',
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

