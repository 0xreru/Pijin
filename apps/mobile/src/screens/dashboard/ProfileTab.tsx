import React, { memo, useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { getUserPhone, getUserFirstName, getUserLastName } from '../../services/storage/onboardingStorage';

interface ProfileTabProps {
  shortId: string;
  publicKey: string;
  insets: { top: number; bottom: number; left: number; right: number };
}

export const ProfileTab = memo(function ProfileTab({ shortId, publicKey, insets }: ProfileTabProps) {
  const navigation = useNavigation<any>();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [fullName, setFullName] = useState('');

  useEffect(() => {
    const fetchPhone = async () => {
      try {
        const phone = await getUserPhone();
        if (phone) {
          setPhoneNumber(phone);
        }
        
        const fName = await getUserFirstName();
        const lName = await getUserLastName();
        if (fName || lName) {
          setFullName(`${fName || ''} ${lName || ''}`.trim());
        }
      } catch (err) {
        console.warn('Could not fetch user phone:', err);
      }
    };
    fetchPhone();
  }, []);

  const formatPhoneNumber = (phone: string) => {
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length !== 10) return phone ? `+63${clean}` : '';
    return `+63 ${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6)}`;
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.tabContentContainer, { paddingTop: Math.max(insets.top, 20) }]}
    >
      <View style={styles.notifHeaderRow}>
        <Ionicons name="person-outline" size={28} color="#001E42" />
        <Text style={styles.tabHeaderTitle}>Profile</Text>
      </View>
      
      
      {/* Profile Card */}
      <View style={styles.profileCard}>
        <View style={styles.profileAvatarContainer}>
          <Ionicons name="person-circle" size={60} color="#001E42" />
        </View>
        <Text style={styles.profileName}>
          {fullName ? fullName : (phoneNumber ? formatPhoneNumber(phoneNumber) : 'My Account')}
        </Text>
        {fullName ? (
          <Text style={styles.profileShortId}>{formatPhoneNumber(phoneNumber)}</Text>
        ) : null}
        <Text style={styles.profileShortId}>Wallet ID: #{shortId}</Text>
        
        <View style={styles.pubKeyContainer}>
          <Text numberOfLines={1} ellipsizeMode="middle" style={styles.pubKeyText}>
            {publicKey || 'Not connected'}
          </Text>
          <TouchableOpacity 
            style={styles.copyBtn} 
            onPress={() => Alert.alert('Copied', 'Public Key copied to clipboard!')}
          >
            <Ionicons name="copy-outline" size={16} color="#4B5563" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Menu List */}
      <View style={styles.menuContainer}>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('AccountSettings')}>
          <View style={styles.menuItemLeft}>
            <Ionicons name="settings-outline" size={20} color="#001E42" />
            <Text style={styles.menuItemText}>Account Settings</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('VaultSettings')}>
          <View style={styles.menuItemLeft}>
            <Ionicons name="wallet-outline" size={20} color="#001E42" />
            <Text style={styles.menuItemText}>Vault Settings</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('ChangePin')}>
          <View style={styles.menuItemLeft}>
            <Ionicons name="lock-closed-outline" size={20} color="#001E42" />
            <Text style={styles.menuItemText}>Change MPIN</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
        </TouchableOpacity>

      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  tabContentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 110,
  },
  notifHeaderRow: {
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
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  profileAvatarContainer: {
    marginBottom: 12,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#001E42',
    marginBottom: 4,
  },
  profileShortId: {
    fontSize: 13,
    color: '#707984',
    fontWeight: '600',
    marginBottom: 16,
  },
  pubKeyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    maxWidth: '100%',
  },
  pubKeyText: {
    fontSize: 12,
    color: '#4B5563',
    fontFamily: 'monospace',
    flex: 1,
    marginRight: 8,
  },
  copyBtn: {
    padding: 2,
  },
  menuContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
});
