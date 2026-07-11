import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

interface DashboardHeaderProps {
  shortId: string;
  isOnline: boolean;
  onLogoutPress: () => void;
}

export function DashboardHeader({ shortId, isOnline, onLogoutPress }: DashboardHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.leftSection}>
        <View style={styles.avatar}>
          <Ionicons name="shield-checkmark" size={24} color="#001E42" />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.greeting}>Short Id: {shortId}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: isOnline ? '#10B981' : '#EF4444' }]} />
            <Text style={styles.statusText}>
              You are <Text style={styles.statusBold}>{isOnline ? 'Online' : 'Offline'}</Text>.
            </Text>
          </View>
        </View>
      </View>
      
      <TouchableOpacity
        style={styles.logoutButton}
        onPress={onLogoutPress}
        activeOpacity={0.7}
      >
        <Ionicons name="log-out-outline" size={20} color="#001E42" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    width: '100%',
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E6E9EE',
    shadowColor: '#001E42',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  userInfo: {
    marginLeft: 12,
  },
  greeting: {
    fontSize: 19,
    fontWeight: '800',
    color: '#001E42',
    letterSpacing: -0.3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 13,
    color: '#4B5563',
  },
  statusBold: {
    fontWeight: '700',
    color: '#001E42',
  },
  logoutButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E6E9EE',
    shadowColor: '#001E42',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
    elevation: 1,
  },
});
