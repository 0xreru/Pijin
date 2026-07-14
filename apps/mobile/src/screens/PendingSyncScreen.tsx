import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '../db/client';
import { paymentQueue } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { AppCard } from '../components/ui/AppCard';
import { useAuth } from '../context/AuthContext';

// Quick helper to format currency since we don't know if formatters is exported
const formatCurrency = (amount: number, currency: string) => {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: currency || 'PHP',
  }).format(amount);
};

export function PendingSyncScreen() {
  const navigation = useNavigation();
  const { activeAccount } = useAuth();
  const shortId = activeAccount?.shortId || '0000';

  const { data: pendingPayments = [] } = useLiveQuery(
    db.select()
      .from(paymentQueue)
      .where(
        and(
          eq(paymentQueue.synced, false),
          eq(paymentQueue.customerShortId, shortId)
        )
      )
      .orderBy(desc(paymentQueue.createdAt))
  );

  const renderItem = ({ item }: { item: any }) => (
    <AppCard style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconContainer}>
          <Ionicons name="time-outline" size={24} color="#EA580C" />
        </View>
        <View style={styles.details}>
          <Text style={styles.merchantId}>To: {item.merchantShortId}</Text>
          <Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text>
        </View>
        <Text style={styles.amount}>{formatCurrency(item.amount, item.currency)}</Text>
      </View>
    </AppCard>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pending Sync Queue</Text>
      </View>
      <FlatList
        data={pendingPayments}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-circle-outline" size={48} color="#10B981" />
            <Text style={styles.emptyText}>All payments synced!</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#EFF1F5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: { marginRight: 16, padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  listContainer: { padding: 16 },
  card: { marginBottom: 12, padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  details: { flex: 1 },
  merchantId: { fontSize: 16, fontWeight: '600', color: '#111827' },
  date: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  amount: { fontSize: 16, fontWeight: '700', color: '#111827' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyText: { marginTop: 16, fontSize: 16, color: '#6B7280', fontWeight: '500' },
});
