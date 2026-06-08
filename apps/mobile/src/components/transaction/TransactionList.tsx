import React from 'react';
import { StyleSheet, View, Text, Image, Dimensions } from 'react-native';
import { Transaction } from '../../types/transaction';
import { TransactionItem } from './TransactionItem';
import { SectionHeader } from '../ui/SectionHeader';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface TransactionListProps {
  transactions: Transaction[];
  onViewAll?: () => void;
}

export function TransactionList({ transactions, onViewAll }: TransactionListProps) {
  const hasTransactions = transactions && transactions.length > 0;

  return (
    <View style={styles.container}>
      <SectionHeader
        title="Recent Activity"
        actionLabel={hasTransactions ? "View All" : undefined}
        onActionPress={onViewAll}
      />
      
      {hasTransactions ? (
        <View style={styles.listContainer}>
          {transactions.map((tx) => (
            <TransactionItem
              key={tx.id}
              id={tx.id}
              title={tx.title}
              subtitle={tx.subtitle}
              amount={tx.amount}
              type={tx.type}
            />
          ))}
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Image
            source={require('../../../assets/home/piji-no-recent.png')}
            style={styles.emptyImage}
            resizeMode="contain"
          />
          <Text style={styles.emptyTitle}>No Activity Yet</Text>
          <Text style={styles.emptySubtitle}>
            Your payments, transfers, and offline transactions will show up here.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 8,
  },
  listContainer: {
    width: '100%',
    paddingVertical: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBF0F5',
    shadowColor: '#031634',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.02,
    shadowRadius: 10,
    elevation: 2,
  },
  emptyImage: {
    width: SCREEN_WIDTH * 0.45,
    height: SCREEN_WIDTH * 0.45,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#031634',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#707984',
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 18,
  },
});
