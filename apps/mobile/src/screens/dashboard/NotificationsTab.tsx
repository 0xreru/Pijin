import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Animated,
  TouchableOpacity,
  Image,
  Dimensions,
  ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface NotificationsTabProps {
  insets: { top: number; bottom: number; left: number; right: number };
}

export function NotificationsTab({ insets }: NotificationsTabProps) {
  const NOTIF_SCREEN_WIDTH = SCREEN_WIDTH - 40;

  const [activeNotificationFilter, setActiveNotificationFilter] = useState<'all' | 'transactions' | 'updates' | 'unread'>('all');
  const notifSlideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const filterIndex = ['all', 'transactions', 'updates', 'unread'].indexOf(activeNotificationFilter);
    Animated.spring(notifSlideAnim, {
      toValue: -filterIndex * NOTIF_SCREEN_WIDTH,
      useNativeDriver: true,
      tension: 45,
      friction: 8.5,
    }).start();
  }, [activeNotificationFilter]);

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
            source={require('../../../assets/notifications/piji-notif.png')}
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
}

const styles = StyleSheet.create({
  tabContentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 110,
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
});
