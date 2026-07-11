import React, { useRef, useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
  Image,
  Dimensions,
  Alert,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import QRCode from 'react-native-qrcode-svg';
import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';
import { connectionService } from '../services/connectionService';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function GenerateQRScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { activeAccount } = useAuth();
  const mode = route.params?.mode || 'receiver';
  const qrData = route.params?.qrData || '';

  const [isOnline, setIsOnline] = useState(connectionService.currentState.isOnlineMode);

  useEffect(() => {
    const subscription = connectionService.state$.subscribe((state) => {
      setIsOnline(state.isOnlineMode);
    });
    return () => subscription.unsubscribe();
  }, []);

  const qrRef = useRef<any>(null);
  const cardRef = useRef<View>(null);

  // For receiver mode: QR code is just the user's shortId
  // For relay mode: QR code is the signed payload passed in qrData
  const qrValue = mode === 'receiver' 
    ? (activeAccount?.shortId || 'M-1B44')
    : qrData;

  const displayName = 'Erickson Guhilde';
  const displayId = activeAccount?.shortId || 'M-1B44';

  // Parse relay voucher details if applicable
  let relayAmount = '';
  let relayCustomer = '';
  let relayMerchant = '';
  if (mode === 'relay' && qrData) {
    const parts = qrData.split(':');
    if (parts.length === 6) {
      relayCustomer = parts[1];
      relayMerchant = parts[2];
      try {
        const { decodeBase62 } = require('../utils/crypto');
        const amountStroops = decodeBase62(parts[3]);
        relayAmount = (Number(amountStroops) / 10000000).toString();
      } catch (e) {
        relayAmount = parts[3];
      }
    } else if (parts.length === 5) {
      relayCustomer = parts[0];
      relayMerchant = parts[1];
      relayAmount = parts[2];
    }
  }

  const handleSaveQr = async () => {
    if (!cardRef.current) {
      Alert.alert('Error', 'QR Code card is not ready yet.');
      return;
    }

    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Pijin needs photos permission to save the QR Code card to your library.');
        return;
      }

      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1.0,
      });

      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved!', 'The QR Code card has been successfully saved to your photo gallery.');
    } catch (err) {
      console.error('Failed to save QR Code to gallery:', err);
      Alert.alert('Error', 'Failed to save the QR Code card to your gallery.');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}>
      <StatusBar barStyle="dark-content" />
      
      <ConnectionWatcher navigation={navigation} currentMode={(isOnline && mode === 'receiver') ? 'online' : 'offline'} />
      
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-undo-outline" size={28} color="#04295A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My QR Code</Text>
      </View>

      {/* Main Content Area */}
      <View style={styles.content}>
        
        {/* White Card */}
        <View style={styles.qrCard}>
          <View ref={cardRef} collapsable={false} style={styles.captureArea}>
            {mode === 'receiver' ? (
              <>
                {/* Header profile area inside card */}
                <View style={styles.cardHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>EG</Text>
                  </View>
                  <View style={styles.headerTextContainer}>
                    <Text style={styles.userName}>{displayName}</Text>
                    <View style={styles.statusBadge}>
                      <View style={styles.greenDot} />
                      <Text style={styles.statusText}>Active Receiver ID</Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.walletLabel}>WALLET ID</Text>
                <Text style={styles.userId}>{displayId}</Text>
              </>
            ) : (
              <>
                {/* Header relay area inside card */}
                <View style={styles.cardHeader}>
                  <View style={[styles.avatar, { backgroundColor: '#FEE2E2' }]}>
                    <Ionicons name="swap-horizontal" size={20} color="#EF4444" />
                  </View>
                  <View style={styles.headerTextContainer}>
                    <Text style={styles.userName}>Offline Relay Voucher</Text>
                    <View style={[styles.statusBadge, { backgroundColor: '#FEF3C7' }]}>
                      <View style={[styles.greenDot, { backgroundColor: '#F59E0B' }]} />
                      <Text style={[styles.statusText, { color: '#B45309' }]}>Awaiting Sync</Text>
                    </View>
                  </View>
                </View>
                {relayAmount ? (
                  <View style={styles.relayDetailsContainer}>
                    <Text style={styles.relayAmountLabel}>Transfer Amount</Text>
                    <Text style={styles.relayAmount}>₱{parseFloat(relayAmount).toFixed(2)}</Text>
                    <Text style={styles.relayRoute}>
                      {relayCustomer} → {relayMerchant}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.userId}>Signed Transaction</Text>
                )}
              </>
            )}
            
            {/* QR Code Container */}
            <View style={styles.qrCodeWrapper}>
              <QRCode
                value={qrValue || 'N/A'}
                size={180}
                color="#04295A"
                backgroundColor="#FFFFFF"
                getRef={(ref) => { qrRef.current = ref; }}
              />
            </View>
          </View>
          
          <View style={styles.divider} />

          {/* Save Button inside card */}
          <TouchableOpacity 
            style={styles.saveButton}
            onPress={handleSaveQr}
            activeOpacity={0.8}
          >
            <Ionicons name="download-outline" size={18} color="#FFFFFF" style={styles.saveIcon} />
            <Text style={styles.saveButtonText}>Save QR Code</Text>
          </TouchableOpacity>
        </View>

        {/* Sub-label under card */}
        <Text style={styles.subLabel}>
          {mode === 'receiver' 
            ? 'Show this QR code to the sender to receive funds.' 
            : 'Show this QR code to a helper/partner to relay your offline payment.'}
        </Text>

        {/* Mascot Image */}
        {/* <View style={styles.mascotContainer}>
          <Image
            source={require('../../assets/qr generation/pijin-qr.png')}
            style={styles.mascotImage}
            resizeMode="contain"
          />
        </View> */}

        {/* Pijin Branding */}
        <View style={styles.footerBranding}>
          <Text style={styles.pijinLogo}>p i j i n</Text>
          <TouchableOpacity 
            onPress={() => Alert.alert('Get help', 'Support channels and FAQs are coming soon!')} 
            activeOpacity={0.7}
          >
            <Text style={styles.getHelpLink}>Get help</Text>
          </TouchableOpacity>
        </View>

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
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#000000',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
    marginTop: 10,
    paddingBottom: 24,
  },
  captureArea: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingTop: 24,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF1F5',
    paddingBottom: 16,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#E5EDF6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#04295A',
  },
  headerTextContainer: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#04295A',
    marginBottom: 3,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F9EE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 5,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#107C41',
    textTransform: 'uppercase',
  },
  walletLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  userId: {
    fontSize: 16,
    fontWeight: '800',
    color: '#04295A',
    marginBottom: 20,
  },
  relayDetailsContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  relayAmountLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  relayAmount: {
    fontSize: 26,
    fontWeight: '900',
    color: '#04295A',
    marginBottom: 2,
  },
  relayRoute: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  qrCodeWrapper: {
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EFF1F5',
    marginBottom: 20,
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#EFF1F5',
    marginBottom: 16,
  },
  saveButton: {
    backgroundColor: '#04295A',
    borderRadius: 25,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  },
  saveIcon: {
    marginRight: 8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  subLabel: {
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
    color: '#707984',
    marginTop: 14,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  mascotContainer: {
    flex: 1,
    width: '100%',
    maxHeight: 130,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 20,
    marginTop: 10,
  },
  mascotImage: {
    width: 120,
    height: '100%',
  },
  footerBranding: {
    alignItems: 'center',
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: '#E6E9EE',
    paddingTop: 12,
    marginTop: 8,
  },
  pijinLogo: {
    fontSize: 24,
    fontWeight: '800',
    color: '#04295A',
    letterSpacing: 8,
    marginBottom: 8,
    left: 4,
  },
  getHelpLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#04295A',
    textDecorationLine: 'underline',
  },
});
