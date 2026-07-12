import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
  TextInput,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function VaultSettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [limit, setLimit] = useState('5000'); // Example default

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
      <StatusBar barStyle="dark-content" />
      
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-undo-outline" size={28} color="#001E42" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Vault Settings</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>Offline Vault Limit (₱)</Text>
          <Text style={styles.description}>
            This is the maximum amount of offline funds you can hold in your secure vault on this device.
          </Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={limit}
            onChangeText={setLimit}
          />
          <TouchableOpacity 
            style={styles.saveBtn}
            onPress={() => {
              Alert.alert('Saved', 'Vault settings updated.');
              navigation.goBack();
            }}
          >
            <Text style={styles.saveBtnText}>Save Changes</Text>
          </TouchableOpacity>
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
  label: { fontSize: 16, fontWeight: '700', color: '#001E42', marginBottom: 8 },
  description: { fontSize: 13, color: '#707984', marginBottom: 20, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    padding: 15,
    fontSize: 18,
    color: '#001E42',
    fontWeight: '600',
    marginBottom: 20,
  },
  saveBtn: {
    backgroundColor: '#04295A',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  saveBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
