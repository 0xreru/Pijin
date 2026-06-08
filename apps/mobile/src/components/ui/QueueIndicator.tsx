import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppCard } from './AppCard';

interface QueueIndicatorProps {
  queueCount: number;
  onSyncPress?: () => void;
  syncing?: boolean;
}

export function QueueIndicator({ queueCount, onSyncPress, syncing = false }: QueueIndicatorProps) {
  if (queueCount === 0) return null;

  return (
    <AppCard style={styles.card}>
      <View style={styles.container}>
        <View style={styles.leftSection}>
          <View style={styles.iconContainer}>
            <Ionicons name="cloud-offline-outline" size={20} color="#EA580C" />
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.title}>Offline Payments Saved</Text>
            <Text style={styles.subtitle}>
              {queueCount} transaction{queueCount > 1 ? 's' : ''} pending connection sync.
            </Text>
          </View>
        </View>

        {onSyncPress && (
          <TouchableOpacity
            style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
            onPress={onSyncPress}
            disabled={syncing}
            activeOpacity={0.8}
          >
            {syncing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="sync-outline" size={14} color="#FFFFFF" style={styles.syncIcon} />
                <Text style={styles.syncButtonText}>Sync</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF7ED', // Soft amber orange
    borderColor: '#FED7AA',
    borderWidth: 1,
    padding: 14,
    marginVertical: 8,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#9A3412',
  },
  subtitle: {
    fontSize: 12,
    color: '#C2410C',
    marginTop: 2,
  },
  syncButton: {
    backgroundColor: '#EA580C',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  syncButtonDisabled: {
    backgroundColor: '#FDBA74',
  },
  syncIcon: {
    marginRight: 4,
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
