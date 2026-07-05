import React, { memo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Animated,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DashboardHeader } from '../../components/ui/DashboardHeader';
import { BalanceCard } from '../../components/wallet/BalanceCard';
import { TransactionList } from '../../components/transaction/TransactionList';
import { QueueIndicator } from '../../components/ui/QueueIndicator';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface HomeTabProps {
  shortId: string;
  isOnline: boolean;
  cachedBalance: number;
  offlineBalance: number;
  queueCount: number;
  syncing: boolean;
  slideAnim: Animated.Value;
  isTransitioning: boolean;
  onlineTxs: any[];
  offlineTxs: any[];
  insets: { top: number; bottom: number; left: number; right: number };
  onLogoutPress: () => void;
  onManualToggle: (online: boolean) => void;
  onSyncQueue: () => void;
  onAddMockQueueItem: () => void;
  onLoadOfflineFundsPress: () => void;
  onSendPress: () => void;
  onReceivePress: () => void;
  onViewAllTransactions: () => void;
  isOnlineDisabled?: boolean;
}

export const HomeTab = memo(function HomeTab({
  shortId,
  isOnline,
  cachedBalance,
  offlineBalance,
  queueCount,
  syncing,
  slideAnim,
  isTransitioning,
  onlineTxs,
  offlineTxs,
  insets,
  onLogoutPress,
  onManualToggle,
  onSyncQueue,
  onAddMockQueueItem,
  onLoadOfflineFundsPress,
  onSendPress,
  onReceivePress,
  onViewAllTransactions,
  isOnlineDisabled = false,
}: HomeTabProps) {
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(insets.top, 12) }]}
      style={styles.scrollView}
    >
      <View style={styles.headerWrapper}>
        <DashboardHeader shortId={shortId} isOnline={isOnline} onLogoutPress={onLogoutPress} />
      </View>
      <View style={{ paddingHorizontal: 20, zIndex: 5 }}>
        {/* Toggle Row (Left Aligned) */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              isOnline ? styles.toggleBtnActive : styles.toggleBtnInactive,
            ]}
            onPress={() => !isOnlineDisabled && onManualToggle(true)}
            activeOpacity={isOnlineDisabled ? 1.0 : 0.85}
            disabled={isOnlineDisabled}
          >
            <Text style={[
              styles.toggleBtnText,
              isOnline ? styles.toggleTextActive : styles.toggleTextInactive,
              isOnlineDisabled && styles.toggleTextDisabled,
            ]}>
              Online
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, !isOnline ? styles.toggleBtnActive : styles.toggleBtnInactive]}
            onPress={() => onManualToggle(false)}
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
                  source={require('../../../assets/home/piji-online.png')}
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
                  onPress={onSendPress}
                  activeOpacity={0.85}
                >
                  <Ionicons name="paper-plane" size={20} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Send</Text>
              </View>

              <View style={styles.actionItem}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={onReceivePress}
                  activeOpacity={0.85}
                >
                  <Ionicons name="arrow-down" size={20} color="#FFFFFF" style={styles.rotatedIcon} />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Receive</Text>
              </View>

              <View style={styles.actionItem}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={() => Alert.alert('Top-Up', 'Open payment gateways to add funds.')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="card" size={20} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Top-Up</Text>
              </View>

              <View style={styles.actionItem}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={() => Alert.alert('Transfer', 'Transfer funds to other bank accounts or wallets.')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="swap-horizontal" size={20} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Transfer</Text>
              </View>

              <View style={styles.actionItem}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={onLoadOfflineFundsPress}
                  activeOpacity={0.85}
                >
                  <Ionicons name="cloud-offline" size={20} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Load Offline Funds</Text>
              </View>
            </View>

            {/* Recent Activity List */}
            <TransactionList
              transactions={onlineTxs}
              onViewAll={onViewAllTransactions}
            />
          </View>

          {/* Panel 2: Offline Content */}
          <View style={[styles.panel, (isOnline && !isTransitioning) && { height: 0, overflow: 'hidden' }]}>
            {/* Card Section with peeking background illustration */}
            <View style={styles.cardSection}>
              <View pointerEvents="none" style={[styles.pijiBackground, styles.pijiOfflineOffset]}>
                <Image
                  source={require('../../../assets/home/piji-offline.png')}
                  style={styles.imageFill}
                  resizeMode="contain"
                />
              </View>
              <BalanceCard
                balance={offlineBalance}
                isOnline={false}
                shortId={shortId}
              />
            </View>

            {/* Queue Indicator Banner (when queue exists in Offline) */}
            {queueCount > 0 && (
              <QueueIndicator
                queueCount={queueCount}
                onSyncPress={onSyncQueue}
                syncing={syncing}
              />
            )}

            {/* Action Row */}
            <View style={styles.actionsContainerOffline}>
              <View style={styles.actionItemOffline}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={onSendPress}
                  activeOpacity={0.85}
                >
                  <Ionicons name="paper-plane" size={20} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Send</Text>
              </View>

              <View style={styles.actionItemOffline}>
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={onReceivePress}
                  activeOpacity={0.85}
                >
                  <Ionicons name="arrow-down" size={20} color="#FFFFFF" style={styles.rotatedIcon} />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Receive</Text>
              </View>
            </View>

            {/* Recent Activity List */}
            <TransactionList
              transactions={offlineTxs}
              onViewAll={onViewAllTransactions}
            />
          </View>
        </Animated.View>
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
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
  toggleTextDisabled: {
    color: '#CBD5E1',
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
    right: -25,
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
    fontSize: 10,
    fontWeight: '600',
    color: '#001E42',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 2,
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
});
