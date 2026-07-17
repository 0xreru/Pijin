import React, { useRef, useState, useEffect } from 'react';
import { Image } from 'expo-image';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
  Dimensions,
  Alert,
  Platform,
  DeviceEventEmitter,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import QRCode from 'react-native-qrcode-svg';
import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';
import { connectionService } from '../services/connectionService';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import { lookupUserByShortId } from '../services/api/accounts';
import { db } from '../db/client';
import { enqueuePayment } from '../db/services/paymentQueueDb';
import { addTransaction } from '../db/services/transactionDb';
import { SMS_GATEWAY_NUMBER } from '../constants/api';
import { OfflineSuccessModal } from '../components/ui/OfflineSuccessModal';
import { ErrorModal } from '../components/ui/ErrorModal';
import { getUserFirstName, getUserLastName, saveUserFirstName, saveUserLastName } from '../services/storage/onboardingStorage';

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

  // Mode: 'relay' state
  const isRelay = mode === 'relay';
  const rawPayload = route.params?.payload; // The offline payload
  const relayAmount = route.params?.amount?.toFixed(2) || '0.00';
  const relayRoute = route.params?.recipientName ? `→ ${route.params.recipientName}` : 'Network SMS';

  const [fullName, setFullName] = useState('OmniFi User');
  const [initials, setInitials] = useState('OU');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [errorVisible, setErrorVisible] = useState(false);
  const [errorContent, setErrorContent] = useState({ title: '', message: '' });
  const hasCommittedRef = useRef(false);

  const qrRef = useRef<View>(null);

  const handleDoneRelaying = async () => {
    if (hasCommittedRef.current) return;
    
    const payload = route.params?.payload;
    const amount = route.params?.amount ?? 0;
    const total = route.params?.total ?? 0;
    const recipientName = route.params?.recipientName ?? '';
    const recipientShortId = route.params?.recipientShortId ?? '';
    const fee = route.params?.fee ?? 0;

    if (!payload) {
      navigation.navigate('Dashboard');
      return;
    }

    try {
      const { loadStoredAccount } = require('../services/storage/accountStorage');
      const account = await loadStoredAccount();
      const customerShortId = payload?.customerShortId || account?.shortId;
      const customerPubKey = payload?.customerPubKey || account?.stellarPublicKey;

      const shortNonce = payload.smsBody ? (payload.smsBody.split(':')[4] || payload.smsBody.split(':')[3] || Math.floor(Math.random() * 1000000).toString()) : Math.floor(Math.random() * 1000000).toString();

      await db.transaction(async (trx) => {
        await enqueuePayment(payload, trx);
        
        await addTransaction({
          id: `TX-OFF-${shortNonce}`,
          title: `Sent to ${recipientName} (Offline)`,
          amount: -amount,
          type: 'outgoing',
          tag: 'OFFLINE',
          description: `Offline local escrow payment of ₱${amount.toFixed(2)} to ${recipientName} (Short ID: ${recipientShortId}) with ₱${fee.toFixed(2)} processing fee.`,
          stellarPublicKey: customerPubKey,
          shortId: customerShortId,
        }, trx);
      });

      hasCommittedRef.current = true;
      DeviceEventEmitter.emit('ON_SEND_MONEY_OFFLINE', total);
      setShowSuccessModal(true);
    } catch (err) {
      console.error('[GenerateQRScreen] Failed to commit offline payment:', err);
      Alert.alert('Error', 'Failed to save the offline transaction locally. Please try again.');
    }
  };

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        let first = await getUserFirstName();
        let last = await getUserLastName();

        if ((!first || !last) && isOnline && activeAccount?.shortId) {
          const lookup = await lookupUserByShortId(activeAccount.shortId);
          if (lookup) {
            first = lookup.firstName || lookup.displayName?.split(' ')[0] || null;
            last = lookup.lastName || lookup.displayName?.split(' ').slice(1).join(' ') || null;
            
            if (first) await saveUserFirstName(first);
            if (last) await saveUserLastName(last);
          }
        }

        if (first || last) {
          const displayFirst = first || 'OmniFi';
          const displayLast = last || 'User';
          setFullName(`${displayFirst} ${displayLast}`.trim());
          setInitials(`${displayFirst.charAt(0)}${displayLast.charAt(0)}`.toUpperCase());
        } else {
          setFullName('OmniFi User');
          setInitials('OU');
        }
      } catch (err) {
        console.error('[GenerateQRScreen] fetchUserData error:', err);
        setFullName('OmniFi User');
        setInitials('OU');
      }
    };
    fetchUserData();
  }, [isOnline, activeAccount]);

  const saveQRCode = async () => {
    try {
      if (qrRef.current) {
        const uri = await captureRef(qrRef, {
          format: 'png',
          quality: 1,
        });

        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          await MediaLibrary.saveToLibraryAsync(uri);
          setErrorContent({ title: 'Success', message: 'QR Code saved to gallery!' });
          setErrorVisible(true);
        } else {
          setErrorContent({ title: 'Permission Denied', message: 'We need permission to save the image to your gallery.' });
          setErrorVisible(true);
        }
      }
    } catch (e) {
      console.error(e);
      setErrorContent({ title: 'Error', message: 'Failed to save QR Code.' });
      setErrorVisible(true);
    }
  };

  const qrValue = mode === 'receiver' 
    ? (activeAccount?.shortId || 'M-1B44')
    : `SMSTO:${SMS_GATEWAY_NUMBER}:${qrData}`;

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#EFF1F5" />
      
      <ConnectionWatcher navigation={navigation} currentMode={isOnline ? 'online' : 'offline'} />

      <View style={styles.headerRow}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()} 
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-undo-outline" size={28} color="#04295A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isRelay ? 'Relay Transaction' : 'Receive Funds'}
        </Text>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 24, paddingVertical: 10 }}>
        
        <View style={styles.qrCard} ref={qrRef}>
          <View style={styles.cardHeader}>
            {!isRelay ? (
              <>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
                <View style={styles.headerTextContainer}>
                  <Text style={styles.userName}>{fullName}</Text>
                  <View style={styles.statusBadge}>
                    <View style={styles.greenDot} />
                    <Text style={styles.statusText}>VERIFIED</Text>
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.relayDetailsContainer}>
                <Text style={styles.relayAmountLabel}>Transfer Amount</Text>
                <Text style={styles.relayAmount}>₱ {relayAmount}</Text>
                <Text style={styles.relayRoute}>{relayRoute}</Text>
              </View>
            )}
          </View>

          {!isRelay && activeAccount?.shortId && (
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <Text style={styles.walletLabel}>Pijin Address</Text>
              <Text style={styles.userId}>{activeAccount.shortId}</Text>
            </View>
          )}

          <View style={{ alignItems: 'center' }}>
            <View style={styles.qrCodeWrapper}>
              <QRCode
                value={qrValue}
                size={SCREEN_WIDTH * 0.55}
                backgroundColor="transparent"
                color="#04295A"
              />
            </View>
          </View>

          <View style={styles.divider} />
          
          {mode === 'relay' ? (
            <View style={{ width: '100%', gap: 12 }}>
              <TouchableOpacity 
                style={[styles.doneRelayingButton, { width: '100%', marginRight: 0, flex: 0 }]}
                onPress={handleDoneRelaying}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark-circle-outline" size={18} color="#FFFFFF" style={styles.saveIcon} />
                <Text style={styles.doneRelayingButtonText}>Done Relaying</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.saveButtonSecondary, { width: '100%', flex: 0 }]}
                onPress={saveQRCode}
                activeOpacity={0.8}
              >
                <Ionicons name="download-outline" size={18} color="#04295A" style={styles.saveIcon} />
                <Text style={styles.saveButtonTextSecondary}>Save QR Code</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ width: '100%', gap: 12 }}>
              <TouchableOpacity 
                style={styles.saveButton}
                onPress={saveQRCode}
                activeOpacity={0.8}
              >
                <Ionicons name="download-outline" size={18} color="#FFFFFF" style={styles.saveIcon} />
                <Text style={styles.saveButtonText}>Save QR Code</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={styles.subLabel}>
          {isRelay 
            ? 'A relay QR ensures your payload is correctly packaged for SMS dispatch by any smartphone.'
            : 'Show this QR code to the sender to securely receive funds to your wallet.'}
        </Text>

        {mode === 'receiver' ? (
          <View style={styles.mascotContainer}>
            <Image
              source={require('../../assets/qr generation/pijin-qr.png')}
              style={styles.mascotImage}
              contentFit="contain"
            />
          </View>
        ) : null}

        <View style={styles.footerBranding}>
          <Text style={styles.pijinLogo}>p i j i n</Text>
          <TouchableOpacity 
            onPress={() => {
              setErrorContent({ title: 'Get help', message: 'Support channels and FAQs are coming soon!' });
              setErrorVisible(true);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.getHelpLink}>Get help</Text>
          </TouchableOpacity>
        </View>

        <ErrorModal
          visible={errorVisible}
          title={errorContent.title}
          message={errorContent.message}
          onDismiss={() => setErrorVisible(false)}
        />
      </View>

      <OfflineSuccessModal
        visible={showSuccessModal}
        onClose={() => {
          setShowSuccessModal(false);
          navigation.navigate('Dashboard');
        }}
      />
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
    padding: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#04295A',
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    padding: 24,
    marginTop: 20,
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#04295A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
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
    flex: 1,
    alignItems: 'center',
    marginBottom: 10,
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
  relayActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  doneRelayingButton: {
    backgroundColor: '#04295A',
    borderRadius: 25,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 2,
    marginRight: 8,
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  },
  doneRelayingButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  saveButtonSecondary: {
    backgroundColor: '#F1F5F9',
    borderRadius: 25,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  saveButtonTextSecondary: {
    color: '#04295A',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
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
    height: 120,
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
