import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { TransactionList } from '../../components/transaction/TransactionList';
import { Transaction } from '../../types/transaction';

interface TransactionsTabProps {
  mockTxs: Transaction[];
  insets: { top: number; bottom: number; left: number; right: number };
}

export function TransactionsTab({ mockTxs, insets }: TransactionsTabProps) {
  const [activeFilter, setActiveFilter] = useState<'all' | 'sent' | 'received'>('all');

  const filteredTxs = mockTxs.filter(tx => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'sent') {
      // Sent transactions generally have negative amounts or are outgoing/transfers
      return tx.amount < 0 || tx.type === 'outgoing' || tx.type === 'transfer';
    }
    if (activeFilter === 'received') {
      // Received transactions have positive amounts or are incoming
      return tx.amount > 0 || tx.type === 'incoming';
    }
    return true;
  });

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.tabContentContainer, { paddingTop: Math.max(insets.top, 20) }]}
    >
      <Text style={styles.tabHeaderTitle}>Transactions</Text>
      
      {/* Mini Tab Filter Bar */}
      <View style={styles.transactionsFilterBar}>
        <TouchableOpacity 
          style={[styles.filterChip, activeFilter === 'all' && styles.filterChipActive]}
          onPress={() => setActiveFilter('all')}
        >
          <Text style={[styles.filterChipText, activeFilter === 'all' && styles.filterChipTextActive]}>All</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.filterChip, activeFilter === 'sent' && styles.filterChipActive]}
          onPress={() => setActiveFilter('sent')}
        >
          <Text style={[styles.filterChipText, activeFilter === 'sent' && styles.filterChipTextActive]}>Sent</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.filterChip, activeFilter === 'received' && styles.filterChipActive]}
          onPress={() => setActiveFilter('received')}
        >
          <Text style={[styles.filterChipText, activeFilter === 'received' && styles.filterChipTextActive]}>Received</Text>
        </TouchableOpacity>
      </View>

      <View style={{ marginTop: 10 }}>
        <TransactionList
          transactions={filteredTxs}
          onViewAll={() => {}}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
});
