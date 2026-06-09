import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

export type TabType = 'home' | 'notifications' | 'scan' | 'transactions' | 'profile';

interface BottomNavBarProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

export function BottomNavBar({ activeTab, onChangeTab }: BottomNavBarProps) {
  const insets = useSafeAreaInsets();

  const renderTabItem = (
    tab: TabType,
    label: string,
    activeIcon: keyof typeof Ionicons.glyphMap,
    inactiveIcon: keyof typeof Ionicons.glyphMap
  ) => {
    const isActive = activeTab === tab;
    return (
      <TouchableOpacity
        style={styles.tabItem}
        onPress={() => onChangeTab(tab)}
        activeOpacity={0.7}
      >
        <Ionicons
          name={isActive ? activeIcon : inactiveIcon}
          size={22}
          color={isActive ? '#3B82F6' : '#8E9CAE'}
        />
        <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : styles.tabLabelInactive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {/* Tab Slots */}
      <View style={styles.navRow}>
        {renderTabItem('home', 'Home', 'home', 'home-outline')}
        {renderTabItem('notifications', 'Notifications', 'notifications', 'notifications-outline')}
        
        {/* Empty space for the floating center QR button */}
        <View style={styles.placeholderItem} />

        {renderTabItem('transactions', 'Transactions', 'receipt', 'receipt-outline')}
        {renderTabItem('profile', 'Profile', 'person', 'person-outline')}
      </View>

      {/* Floating Center QR Button */}
      <TouchableOpacity
        style={styles.qrButtonWrapper}
        onPress={() => onChangeTab('scan')}
        activeOpacity={0.85}
      >
        {/* Outer Dark Grey Ring */}
        <View style={styles.qrOuterRing}>
          {/* Middle White Ring */}
          <View style={styles.qrMiddleRing}>
            {/* Inner Dark Blue Circle */}
            <View style={styles.qrInnerCircle}>
              <Ionicons name="qr-code" size={24} color="#FFFFFF" />
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#00112A', // Deep navy background
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  navRow: {
    flexDirection: 'row',
    height: 58,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },
  tabLabelActive: {
    color: '#3B82F6', // Blue color matching active icon
  },
  tabLabelInactive: {
    color: '#8E9CAE', // Muted color matching inactive icon
  },
  qrButtonWrapper: {
    position: 'absolute',
    top: -24,
    alignSelf: 'center',
    zIndex: 10,
  },
  qrOuterRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#374151', // Dark grey outer layer
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  qrMiddleRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#FFFFFF', // White ring
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrInnerCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#00224E', // Inner dark blue circle
    alignItems: 'center',
    justifyContent: 'center',
  },
});

