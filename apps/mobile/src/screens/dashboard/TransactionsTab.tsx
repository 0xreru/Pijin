import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Animated,
  Image,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { Transaction } from '../../types/transaction';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface TransactionsTabProps {
  mockTxs: any[];
  insets: { top: number; bottom: number; left: number; right: number };
}

export function TransactionsTab({ mockTxs, insets }: TransactionsTabProps) {
  const navigation = useNavigation<any>();
  const TRANS_SCREEN_WIDTH = SCREEN_WIDTH - 40;
  const [activeFilter, setActiveFilter] = useState<'all' | 'wallet' | 'offline'>('all');
  const transSlideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const filterIndex = ['all', 'wallet', 'offline'].indexOf(activeFilter);
    Animated.spring(transSlideAnim, {
      toValue: -filterIndex * TRANS_SCREEN_WIDTH,
      useNativeDriver: true,
      tension: 45,
      friction: 8.5,
    }).start();
  }, [activeFilter]);

  const handleFilterChange = (filter: 'all' | 'wallet' | 'offline') => {
    setActiveFilter(filter);
  };

  const renderFilterChip = (filter: 'all' | 'wallet' | 'offline', label: string) => {
    const isActive = activeFilter === filter;
    return (
      <TouchableOpacity
        key={filter}
        style={[styles.filterChip, isActive ? styles.filterChipActive : styles.filterChipInactive]}
        onPress={() => handleFilterChange(filter)}
        activeOpacity={0.8}
      >
        <Text style={[styles.filterChipText, isActive ? styles.filterChipTextActive : styles.filterChipTextInactive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const formatPhp = (val: number, type: string) => {
    const isIncoming = type === 'incoming' || type === 'settlement';
    const formatted = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(Math.abs(val));
    return isIncoming ? `+ ${formatted}` : `- ${formatted}`;
  };

  const mappedTxs = (mockTxs || []).map(tx => ({
    ...tx,
    amountPhp: formatPhp(tx.amount, tx.type),
  }));

  const renderTransactionList = (items: typeof mappedTxs) => {
    // Group items by dateGroup
    const groups: { [key: string]: typeof mappedTxs } = {};
    items.forEach(item => {
      if (!groups[item.dateGroup]) {
        groups[item.dateGroup] = [];
      }
      groups[item.dateGroup].push(item);
    });

    const groupKeys = Object.keys(groups);

    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        style={{ flex: 1 }}
      >
        {groupKeys.map(dateKey => (
          <View key={dateKey} style={styles.groupContainer}>
            {/* Horizontal Line with Center Date Tag */}
            <View style={styles.dateHeaderRow}>
              <View style={styles.dateDividerLine} />
              <View style={styles.dateBadge}>
                <Text style={styles.dateBadgeText}>{dateKey}</Text>
              </View>
            </View>

            {/* Group Cards */}
            {groups[dateKey].map(tx => (
              <TouchableOpacity
                key={tx.id}
                style={styles.cardContainer}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('TransactionReceipt', { transaction: tx })}
              >
                {/* Header Row */}
                <View style={styles.cardHeader}>
                  <View style={[
                    styles.walletTag,
                    tx.tag === 'OFFLINE' && { backgroundColor: '#F59E0B' }
                  ]}>
                    <Text style={styles.walletTagText}>{tx.tag}</Text>
                  </View>
                  <Text style={styles.timeAgoText}>{tx.timeAgo}</Text>
                </View>

                {/* Info Column */}
                <Text style={styles.txTitle}>{tx.title}</Text>
                <Text style={[
                  styles.txAmount,
                  (tx.type === 'incoming' || tx.type === 'settlement') && { color: '#10B981' }
                ]}>{tx.amountPhp}</Text>
                <Text style={styles.txDesc}>{tx.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    );
  };

  const renderEmptyState = () => {
    return (
      <View style={styles.emptyStateContainer}>
        <Image
          source={require('../../../assets/transactions/piji-transactions.png')}
          style={styles.emptyStateImage}
          resizeMode="contain"
        />
        <Text style={styles.emptyStateText}>No transactions.</Text>
      </View>
    );
  };

  const renderPanel = (items: typeof mappedTxs) => {
    if (items.length === 0) {
      return renderEmptyState();
    }
    return renderTransactionList(items);
  };

  const allTxs = mappedTxs;
  const walletTxs = mappedTxs.filter(tx => tx.tag === 'WALLET');
  const offlineTxs = mappedTxs.filter(tx => tx.tag === 'OFFLINE');

  return (
    <View style={[styles.tabContentContainer, { paddingTop: Math.max(insets.top, 20), flex: 1 }]}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <Ionicons name="receipt-outline" size={28} color="#001E42" />
        <Text style={styles.tabHeaderTitle}>Transactions</Text>
      </View>

      {/* Filter Bar */}
      <View style={styles.filterContainer}>
        <Text style={styles.filterLabel}>Filter</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {renderFilterChip('all', 'All')}
          {renderFilterChip('wallet', 'Wallet')}
          {renderFilterChip('offline', 'Offline Funds')}
        </ScrollView>
      </View>

      {/* Horizontal Sliding Panels */}
      <View style={{ flex: 1, overflow: 'hidden', marginTop: 10 }}>
        <Animated.View
          style={{
            flexDirection: 'row',
            width: TRANS_SCREEN_WIDTH * 3,
            flex: 1,
            transform: [{ translateX: transSlideAnim }],
          }}
        >
          {/* Panel 0: All */}
          <View style={{ width: TRANS_SCREEN_WIDTH, flex: 1 }}>
            {renderPanel(allTxs)}
          </View>

          {/* Panel 1: Wallet */}
          <View style={{ width: TRANS_SCREEN_WIDTH, flex: 1 }}>
            {renderPanel(walletTxs)}
          </View>

          {/* Panel 2: Offline Funds */}
          <View style={{ width: TRANS_SCREEN_WIDTH, flex: 1 }}>
            {renderPanel(offlineTxs)}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  tabHeaderTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#001E42',
  },
  filterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  filterLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginRight: 12,
  },
  filterScroll: {
    gap: 8,
    paddingRight: 20,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipActive: {
    backgroundColor: '#04295A',
    borderColor: '#04295A',
  },
  filterChipInactive: {
    backgroundColor: 'transparent',
    borderColor: '#D1D5DB',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  filterChipTextInactive: {
    color: '#1F2937',
  },
  groupContainer: {
    marginBottom: 20,
  },
  dateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    height: 30,
    marginBottom: 16,
  },
  dateDividerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#D1D5DB',
  },
  dateBadge: {
    backgroundColor: '#04295A',
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderRadius: 12,
    zIndex: 2,
  },
  dateBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  cardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    alignItems: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  walletTag: {
    backgroundColor: '#2B5783',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  walletTagText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  timeAgoText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  txTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#001E42',
    textAlign: 'center',
    marginBottom: 8,
  },
  txAmount: {
    fontSize: 26,
    fontWeight: '800',
    color: '#04295A',
    textAlign: 'center',
    marginBottom: 8,
  },
  txDesc: {
    fontSize: 12,
    color: '#707984',
    textAlign: 'center',
    lineHeight: 18,
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
