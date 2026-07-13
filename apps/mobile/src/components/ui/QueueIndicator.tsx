import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppCard } from './AppCard';

interface QueueIndicatorProps {
  queueCount: number;
  onPress?: () => void;
  syncing?: boolean;
}

export function QueueIndicator({ queueCount, onPress, syncing = false }: QueueIndicatorProps) {
  if (queueCount === 0) return null;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={{ marginVertical: 8 }}>
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
          <View style={styles.rightIcon}>
             <Ionicons name="chevron-forward" size={20} color="#C2410C" />
          </View>
        </View>
      </AppCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF7ED', // Soft amber orange
    borderColor: '#FED7AA',
    borderWidth: 1,
    padding: 14,
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
  rightIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  }
});
