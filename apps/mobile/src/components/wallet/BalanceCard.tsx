import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, Dimensions, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface BalanceCardProps {
  balance: number;
  isOnline: boolean;
  shortId: string;
  /** When true, shows a spinner badge instead of "Synced" — used during post-deposit balance polling. */
  isUpdating?: boolean;
}

export function BalanceCard({ balance, isOnline, isUpdating = false }: BalanceCardProps) {
  const [isVisible, setIsVisible] = useState(true);

  // Format currency
  const formatCurrency = (val: number) => {
    if (!isVisible) return '₱ ••••••';
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(val);
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#02132B', '#04224C']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* Top Row */}
        <View style={styles.topRow}>
          <View style={styles.statusWrapper}>
            <Ionicons
              name={isOnline ? 'wifi' : 'wifi-outline'}
              size={18}
              color="#FFFFFF"
              style={styles.statusIcon}
            />
            <Text style={styles.statusText}>
              {isOnline ? 'Online Balance' : 'Offline Balance'}
            </Text>
          </View>
          
          {isOnline ? (
            isUpdating ? (
              <View style={styles.updatingBadge}>
                <ActivityIndicator size={11} color="#031634" style={styles.badgeIcon} />
                <Text style={styles.updatingText}>Updating…</Text>
              </View>
            ) : (
              <View style={styles.syncedBadge}>
                <Ionicons name="cloud-done-outline" size={13} color="#031634" style={styles.badgeIcon} />
                <Text style={styles.syncedText}>Synced</Text>
              </View>
            )
          ) : (
            <Ionicons name="card-outline" size={20} color="#FFFFFF" />
          )}
        </View>

        {/* Center: Balance & Eye Toggle */}
        <View style={styles.balanceRow}>
          <Text style={styles.balanceText}>{formatCurrency(balance)}</Text>
          <TouchableOpacity
            onPress={() => setIsVisible(!isVisible)}
            activeOpacity={0.7}
            style={styles.eyeButton}
          >
            <Ionicons
              name={isVisible ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color="#FFFFFF"
              style={styles.eyeIcon}
            />
          </TouchableOpacity>
        </View>

        {/* Bottom Row (Offline Syncing Indicator) */}
        <View style={styles.bottomRow}>
          {!isOnline && (
            <View style={styles.syncingBadge}>
              <Ionicons name="sync-outline" size={12} color="#031634" style={styles.badgeIcon} />
              <Text style={styles.syncingText}>Syncing</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* Card Page Indicators */}
      <View style={styles.pageIndicatorRow}>
        <View style={[styles.pageDot, styles.pageDotActive]} />
        <View style={[styles.pageDot, styles.pageDotInactive]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    marginVertical: 12,
  },
  card: {
    width: '100%',
    height: 190,
    borderRadius: 24,
    padding: 24,
    justifyContent: 'space-between',
    shadowColor: '#031634',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 8,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIcon: {
    marginRight: 8,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.9,
  },
  syncedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  badgeIcon: {
    marginRight: 4,
  },
  syncedText: {
    color: '#031634',
    fontSize: 11,
    fontWeight: '700',
  },
  updatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  updatingText: {
    color: '#92400E',
    fontSize: 11,
    fontWeight: '700',
  },
  syncingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    alignSelf: 'flex-end',
  },
  syncingText: {
    color: '#031634',
    fontSize: 11,
    fontWeight: '700',
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  balanceText: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  eyeButton: {
    marginLeft: 12,
    padding: 4,
  },
  eyeIcon: {
    opacity: 0.8,
  },
  bottomRow: {
    height: 24,
    justifyContent: 'center',
  },
  pageIndicatorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 3,
  },
  pageDotActive: {
    backgroundColor: '#707984',
  },
  pageDotInactive: {
    backgroundColor: '#D1D5DB',
  },
});


