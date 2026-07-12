import React, { memo, useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Animated,
  TouchableOpacity,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useNavigation } from '@react-navigation/native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface NotificationsTabProps {
  insets: { top: number; bottom: number; left: number; right: number };
  transactions?: any[];
  readIds?: string[];
  onMarkAsRead?: (id: string) => void;
  onMarkAllAsRead?: () => void;
}

export const NotificationsTab = memo(function NotificationsTab({ insets, transactions = [], readIds = [], onMarkAsRead, onMarkAllAsRead }: NotificationsTabProps) {
  const navigation = useNavigation<any>();
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

  const formatTimeAgo = React.useCallback((dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    
    if (diffMs < 0) return 'Just now';
    
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
    return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
  }, []);

  const notifs = React.useMemo(() => {
    return transactions.map((tx) => {
      let title = 'Update';
      let body = '';
      let initials = 'OM'; // Default

      if (tx.type === 'incoming') {
        title = 'Transfer Received';
        body = tx.title + ' ';
      } else if (tx.type === 'outgoing' || tx.type === 'transfer') {
        title = 'Transfer Sent';
        body = tx.title + ' ';
      } else {
        title = 'Transaction';
        body = tx.title + ' ';
      }

      // Try to extract initials from title (e.g. "Received from Maria")
      const match = tx.title.match(/from\s+(.*)|to\s+(.*)/i);
      if (match) {
        const name = match[1] || match[2];
        if (name && name.length >= 2) {
          initials = name.substring(0, 2).toUpperCase();
        }
      }

      const isUnread = tx.createdAt ? (new Date().getTime() - new Date(tx.createdAt).getTime() < 24 * 60 * 60 * 1000) && !readIds.includes(tx.id) : false;

      return {
        id: tx.id,
        title,
        body,
        amount: `₱${Math.abs(tx.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        time: tx.createdAt ? formatTimeAgo(tx.createdAt) : tx.timeAgo,
        type: 'transaction',
        unread: isUnread,
        initials,
        rawTx: tx,
      };
    });
  }, [transactions, formatTimeAgo, readIds]);

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

  const renderNotifList = (items: any[]) => {
    if (items.length > 0) {
      return (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          style={{ flex: 1 }}
        >
          <View style={styles.notifList}>
            {items.map((item, index) => (
              <View key={item.id} style={[styles.notifItemContainer, item.unread && styles.notifItemUnread]}>
                <TouchableOpacity 
                  style={styles.notifRow}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (item.unread && onMarkAsRead) {
                      onMarkAsRead(item.id);
                    }
                    navigation.navigate('TransactionReceipt', { transaction: item.rawTx });
                  }}
                >
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
                </TouchableOpacity>

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

      {/* Latest Label & Mark all as read */}
      <View style={styles.latestRow}>
        <Text style={styles.latestTitle}>Latest</Text>
        <TouchableOpacity onPress={onMarkAllAsRead}>
          <Text style={{ color: '#3B82F6', fontWeight: '600', fontSize: 14 }}>Mark all as read</Text>
        </TouchableOpacity>
      </View>

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
            {renderNotifList(notifs)}
          </View>

          {/* Panel 1: Transactions */}
          <View style={{ width: NOTIF_SCREEN_WIDTH, flex: 1 }}>
            {renderNotifList(notifs.filter(item => item.type === 'transaction'))}
          </View>

          {/* Panel 2: Updates */}
          <View style={{ width: NOTIF_SCREEN_WIDTH, flex: 1 }}>
            {renderNotifList(notifs.filter(item => item.type === 'update'))}
          </View>

          {/* Panel 3: Unread */}
          <View style={{ width: NOTIF_SCREEN_WIDTH, flex: 1 }}>
            {renderNotifList(notifs.filter(item => item.unread))}
          </View>
        </Animated.View>
      </View>
    </View>
  );
});

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
    backgroundColor: '#04295A',
    borderColor: '#04295A',
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
  latestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  latestTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  notifList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  notifItemContainer: {
    width: '100%',
  },
  notifItemUnread: {
    backgroundColor: '#F0F8FF', // Light blue highlight for unread
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
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
