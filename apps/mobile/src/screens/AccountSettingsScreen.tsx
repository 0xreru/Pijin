import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getUserPhone, getUserFirstName, getUserLastName, getUserEmail } from '../services/storage/onboardingStorage';

export function AccountSettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setPhone(await getUserPhone() || '');
      const f = await getUserFirstName() || '';
      const l = await getUserLastName() || '';
      setName(`${f} ${l}`.trim());
      setEmail(await getUserEmail() || '');
    };
    fetchData();
  }, []);

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
      <StatusBar barStyle="dark-content" />
      
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-undo-outline" size={28} color="#001E42" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account Settings</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>Full Name</Text>
            <Text style={styles.value}>{name || 'Not provided'}</Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Phone Number</Text>
            <Text style={styles.value}>{phone || 'Not provided'}</Text>
          </View>
          <View style={[styles.field, { borderBottomWidth: 0 }]}>
            <Text style={styles.label}>Email Address</Text>
            <Text style={styles.value}>{email || 'Not provided'}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#EFF1F5' },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 20 },
  backButton: { marginRight: 15 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#001E42' },
  content: { paddingHorizontal: 20 },
  card: { backgroundColor: '#FFF', borderRadius: 20, padding: 20 },
  field: { borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingVertical: 15 },
  label: { fontSize: 13, color: '#707984', marginBottom: 4 },
  value: { fontSize: 16, fontWeight: '600', color: '#001E42' },
});
