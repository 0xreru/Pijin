import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, StatusBar } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function GenerateQRScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const mode = route.params?.mode || 'receiver';
  const qrData = route.params?.qrData || 'N/A';

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
      <StatusBar barStyle="dark-content" />
      
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-undo-outline" size={28} color="#04295A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {mode === 'receiver' ? 'Receiver Scan' : 'Relay Send'}
        </Text>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.title}>Scan My Screen</Text>
        <Text style={styles.subtitle}>
          Have the partner or receiver point their camera at this QR code.
        </Text>

        {/* Mock QR Container */}
        <View style={styles.qrContainer}>
          <Ionicons name="qr-code" size={180} color="#04295A" />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Payload Data:</Text>
          <Text style={styles.cardValue}>{qrData}</Text>
        </View>
        
        <TouchableOpacity 
          style={styles.btn}
          onPress={() => navigation.navigate('Dashboard')}
          activeOpacity={0.8}
        >
          <Text style={styles.btnText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EFF1F5',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  backButton: {
    marginRight: 15,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#04295A',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingBottom: 50,
  },
  qrContainer: {
    backgroundColor: '#FFFFFF',
    padding: 24,
    borderRadius: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 30,
    borderWidth: 1.5,
    borderColor: '#04295A',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#04295A',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#707984',
    textAlign: 'center',
    marginBottom: 30,
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    marginBottom: 30,
    alignItems: 'center',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#707984',
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#04295A',
  },
  btn: {
    backgroundColor: '#04295A',
    height: 50,
    borderRadius: 25,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
