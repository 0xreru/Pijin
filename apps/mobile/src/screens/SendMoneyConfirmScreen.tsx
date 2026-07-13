import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  Animated,
  PanResponder,
  Modal,
  Dimensions,
  StatusBar,
  DeviceEventEmitter,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { loadStoredAccount } from '../services/storage/accountStorage';
import { ensureMigration } from '../services/storage/migration';
import { enqueuePayment } from '../db/services/paymentQueueDb';
import { OfflinePaymentPayload } from '../types/payment';
import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BUTTON_WIDTH = 56;
const TRACK_WIDTH = SCREEN_WIDTH - 40;
const MAX_SWIPE = TRACK_WIDTH - BUTTON_WIDTH - 8;
const STROOPS_PER_UNIT = 10_000_000;

function amountToStroops(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid transfer amount: ${amount}`);
  }
  return BigInt(Math.round(amount * STROOPS_PER_UNIT));
}

async function executeTransfer(input: { senderPublicKey: string; recipientPublicKey: string; amount: number }): Promise<string | undefined> {
  const { Keypair, TransactionBuilder } = require('@stellar/stellar-sdk');
  const { getMainWalletSecret } = require('../services/storage/onboardingStorage');

  const mainWalletSecret = await getMainWalletSecret();
  if (!mainWalletSecret) {
    throw new Error('No main wallet secret found in SecureStore.');
  }

  const mainWalletKeypair = Keypair.fromSecret(mainWalletSecret);
  const mainWalletPublicKey = mainWalletKeypair.publicKey();
  if (mainWalletPublicKey !== input.senderPublicKey) {
    throw new Error('Main wallet mismatch.');
  }

  const amountStroops = amountToStroops(input.amount).toString();

  const canonicalMessage = `transfer:${mainWalletPublicKey}:${input.recipientPublicKey}:${amountStroops}`;
  const sigBuffer = mainWalletKeypair.sign(Buffer.from(canonicalMessage));
  const sigBase64 = Buffer.from(sigBuffer).toString('base64');

  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/^['"]|['"]$/g, '');
  const tokenAddress = process.env.EXPO_PUBLIC_TOKEN_ID?.trim().replace(/^['"]|['"]$/g, '');
  const rpcUrl = process.env.EXPO_PUBLIC_SOROBAN_RPC_URL?.trim().replace(/^['"]|['"]$/g, '');
  const networkPassphrase = process.env.EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE?.trim().replace(/^['"]|['"]$/g, '');

  const assembleResponse = await fetch(`${apiBase}/api/engine/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sigBase64}`,
    },
    body: JSON.stringify({
      senderPublicKey: mainWalletPublicKey,
      recipientPublicKey: input.recipientPublicKey,
      tokenAddress,
      amountStroops,
    }),
  });

  const assembleData = await assembleResponse.json().catch(() => ({}));
  if (!assembleResponse.ok) {
    throw new Error(`Transfer failed: ${assembleData?.error ?? `HTTP ${assembleResponse.status}`}`);
  }

  const xdr = assembleData.xdr;
  if (!xdr) {
    throw new Error('Backend did not return an XDR envelope');
  }

  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  tx.sign(mainWalletKeypair);
  const rawXdr = tx.toEnvelope().toXDR();
  let bytes: Uint8Array;
  if (rawXdr instanceof Uint8Array) {
    bytes = rawXdr;
  } else if (typeof rawXdr === 'string') {
    bytes = new Uint8Array(rawXdr.length);
    for (let i = 0; i < rawXdr.length; i++) {
      bytes[i] = rawXdr.charCodeAt(i) & 0xff;
    }
  } else {
    bytes = new Uint8Array(rawXdr);
  }
  const signedXdrBase64 = Buffer.from(bytes).toString('base64');

  const sendResp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction: signedXdrBase64 },
    }),
  });
  const sendData = await sendResp.json();
  if (sendData.error) throw new Error(sendData.error.message);
  if (sendData.result?.status === 'ERROR') throw new Error(`Sending failed on network`);
  
  const txHash = sendData.result?.hash;

  if (txHash) {
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const pollResp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'getTransaction',
          params: { hash: txHash },
        }),
      });
      const pollData = await pollResp.json();
      const status = pollData.result?.status;
      if (status === 'SUCCESS') break;
      if (status === 'FAILED') throw new Error(`On-chain transaction FAILED.`);
    }
  }
  return txHash;
}

// No mock contacts — recipient data is always fetched live from the backend
// by SendMoneyScreen before navigating here.

export function SendMoneyConfirmScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { activeAccount } = useAuth();

  // Extract params — receiverPubKey and recipientName are set by SendMoneyScreen
  // after a successful /api/users/lookup call. They represent the REAL on-chain
  // address fetched from the DB, ensuring XDR signature parity with the backend.
  const {
    recipientShortId,
    amount,
    note = '',
    recipientName: paramRecipientName,
    receiverPubKey,
  } = route.params || { recipientShortId: '', amount: 0, note: '' };

  const fee = 0.50;
  const total = amount + fee;
  const senderShortId = activeAccount?.shortId || '0000';

  const recipientName: string = paramRecipientName || recipientShortId || 'Unknown Recipient';
  const recipientInitials: string = recipientName
    .split(' ')
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('') || 'UR';

  // States
  const [isLoading, setIsLoading] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const isCheckedRef = useRef(false);
  const [isOnlineMode, setIsOnlineMode] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const checkState = async () => {
      await ensureMigration();
      const onlineStr = await AsyncStorage.getItem('pijn.is_online');
      setIsOnlineMode(onlineStr !== 'false');
    };
    checkState();
  }, []);

  const [actualTxId, setActualTxId] = useState<string | null>(null);
  const [txId] = useState(() => {
    let id = 'TX-';
    for (let i = 0; i < 12; i++) {
      id += Math.floor(Math.random() * 10).toString();
    }
    return id;
  });
  const [ledgerNum] = useState(() => Math.floor(Math.random() * 10000000) + 48000000);

  // Swipe Animation states
  const swipeAnim = useRef(new Animated.Value(0)).current;

  // Ripple animations for slider success
  const rippleScale = useRef(new Animated.Value(0.5)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;

  const textColor = swipeAnim.interpolate({
    inputRange: [0, MAX_SWIPE * 0.4, MAX_SWIPE * 0.75],
    outputRange: [isChecked ? '#7B889B' : '#94A3B8', '#7B889B', '#FFFFFF'],
  });

  const chevronOpacity = swipeAnim.interpolate({
    inputRange: [0, MAX_SWIPE * 0.6],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isCheckedRef.current,
      onMoveShouldSetPanResponder: () => isCheckedRef.current,
      onPanResponderMove: (evt, gestureState) => {
        if (!isCheckedRef.current) return;
        let newX = gestureState.dx;
        if (newX < 0) newX = 0;
        if (newX > MAX_SWIPE) newX = MAX_SWIPE;
        swipeAnim.setValue(newX);
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (!isCheckedRef.current) return;
        if (gestureState.dx >= MAX_SWIPE * 0.85) {
          // Snap to end & trigger action
          Animated.timing(swipeAnim, {
            toValue: MAX_SWIPE,
            duration: 120,
            useNativeDriver: false,
          }).start(() => {
            // Ripple effect
            rippleScale.setValue(0.5);
            rippleOpacity.setValue(1);
            Animated.parallel([
              Animated.timing(rippleScale, {
                toValue: 3.5,
                duration: 500,
                useNativeDriver: false,
              }),
              Animated.timing(rippleOpacity, {
                toValue: 0,
                duration: 500,
                useNativeDriver: false,
              }),
            ]).start(async () => {
              setIsLoading(true);
              swipeAnim.setValue(0); // reset

              if (isOnlineMode) {
                try {
                  if (!activeAccount?.stellarPublicKey) throw new Error('No active account key');
                  if (!receiverPubKey) throw new Error('No recipient public key');
                  
                  const hash = await executeTransfer({
                    senderPublicKey: activeAccount.stellarPublicKey,
                    recipientPublicKey: receiverPubKey,
                    amount: amount, 
                  });
                  setActualTxId(hash || null);
                  setIsLoading(false);
                  setSuccessVisible(true);
                } catch (err: any) {
                  console.error('Online transfer failed:', err);
                  setIsLoading(false);
                  Alert.alert('Transfer Failed', String(err.message || err));
                }
              } else {
                setTimeout(() => {
                  setIsLoading(false);
                  setSuccessVisible(true);
                }, 1800);
              }
            });
          });
        } else {
          // Slide back
          Animated.timing(swipeAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  const handleToggleCheckbox = () => {
    const nextVal = !isChecked;
    setIsChecked(nextVal);
    isCheckedRef.current = nextVal;
    
    // Reset swipe position if unchecked
    if (!nextVal) {
      Animated.timing(swipeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  };

  const handleBackToHome = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setSuccessVisible(false);
    
    const { addTransaction } = require('../db/services/transactionDb');
    if (isOnlineMode) {
      try {
        await addTransaction({
          title: `Paid to ${recipientName}`,
          amount: -total,
          type: 'outgoing',
          tag: 'WALLET',
          description: `You paid ₱${amount.toFixed(2)} to ${recipientName} (Short ID: ${recipientShortId}) with ₱${fee.toFixed(2)} service fee via Pijin.`,
          stellarPublicKey: activeAccount?.stellarPublicKey,
          shortId: activeAccount?.shortId,
        });
      } catch (err) {
        console.error('Failed to log online transaction:', err);
      } finally {
        setIsProcessing(false);
      }
      DeviceEventEmitter.emit('ON_SEND_MONEY_ONLINE', total);
      navigation.navigate('Dashboard');
    } else {
      // Build offline payment payload and navigate to TransportChoice.
      // We do NOT write to database or deduct balance here. We defer it until the user selects a transport option on the TransportChoiceScreen.
      try {
        const account = await loadStoredAccount();
        const customerId = account?.shortId || '1234';
        const merchantId = recipientShortId;

        // receiverPubKey was resolved from the backend by SendMoneyScreen.
        // Guard here in case the screen is ever reached without it.
        if (!receiverPubKey) {
          Alert.alert(
            'Key Resolution Error',
            'Receiver public key is missing. Please go back and search for the recipient again.'
          );
          setIsProcessing(false);
          return;
        }

        const { buildOfflineSmsVoucher } = require('../services/offline/buildSmsPayload');
        const voucher = await buildOfflineSmsVoucher({
          receiverShortId: merchantId,
          receiverPubKey,
          amountPhp: amount,
        });

        const payload: OfflinePaymentPayload = {
          type: 'PIJIN_OFFLINE_PAYMENT',
          version: 2,
          amount: amount,
          currency: 'PHP',
          customerShortId: customerId,
          merchantShortId: merchantId,
          customerPublicKey: activeAccount?.stellarPublicKey || undefined,
          smsBody: voucher.smsBody,
          createdAt: new Date().toISOString(),
          expiresInMinutes: 10,
        };

        navigation.navigate('TransportChoice', {
          qrData: voucher.smsBody,
          payload,
          amount,
          total,
          recipientName,
          recipientShortId,
          fee
        });
      } catch (err) {
        console.error('Failed to build offline voucher:', err);
        navigation.navigate('Dashboard');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const formatCurrency = (val: number) => {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Programmatic Barcode View
  const Barcode = () => (
    <View style={styles.barcodeContainer}>
      {Array.from({ length: 38 }).map((_, i) => {
        const barWidth = i % 4 === 0 ? 3 : i % 3 === 0 ? 1 : 2;
        const barMargin = i % 5 === 0 ? 3 : 1.5;
        return (
          <View
            key={i}
            style={[
              styles.barcodeBar,
              {
                width: barWidth,
                marginRight: barMargin,
              },
            ]}
          />
        );
      })}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
      <StatusBar barStyle="dark-content" />

      <ConnectionWatcher navigation={navigation} currentMode={isOnlineMode ? 'online' : 'offline'} />

      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-undo-outline" size={28} color="#04295A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Verification</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) }]}
      >
        {/* Hero Send Amount display */}
        <View style={styles.amountHeroContainer}>
          <Text style={styles.amountLabel}>Total Transfer Amount</Text>
          <View style={styles.amountDisplayRow}>
            <Text style={styles.amountSymbol}>₱</Text>
            <Text style={styles.amountValue}>{formatCurrency(amount)}</Text>
          </View>
          <View style={styles.networkBadge}>
            <View style={[styles.greenPulseDot, !isOnlineMode && { backgroundColor: '#F59E0B' }]} />
            <Text style={styles.networkBadgeText}>
              {isOnlineMode ? 'Stellar Network Escrow (PHP Vault)' : 'Offline Local Escrow'}
            </Text>
          </View>
        </View>

        {/* Detailed Info Card */}
        <View style={styles.infoCard}>
          {/* Recipient Row */}
          <View style={styles.partyRow}>
            <View style={styles.partyAvatar}>
              <Text style={styles.partyAvatarText}>{recipientInitials}</Text>
            </View>
            <View style={styles.partyDetails}>
              <Text style={styles.partyLabel}>Recipient Account</Text>
              <Text style={styles.partyName}>{recipientName}</Text>
              <Text style={styles.partySub}>Short ID: {recipientShortId}</Text>
            </View>
          </View>

          <View style={styles.cardSeparator} />

          {/* Sender Row */}
          <View style={styles.partyRow}>
            <View style={[styles.partyAvatar, { backgroundColor: '#E0F2FE' }]}>
              <Ionicons name="wallet-outline" size={20} color="#0284C7" />
            </View>
            <View style={styles.partyDetails}>
              <Text style={styles.partyLabel}>Sender Account</Text>
              <Text style={styles.partyName}>My Vault Wallet</Text>
              <Text style={styles.partySub}>Short ID: {senderShortId}</Text>
            </View>
          </View>

          {/* Note Box */}
          {note.trim().length > 0 && (
            <View style={styles.memoContainer}>
              <Text style={styles.memoTitle}>Note/Memo:</Text>
              <Text style={styles.memoText}>{note}</Text>
            </View>
          )}
        </View>

        {/* Breakdown Details */}
        <View style={styles.detailsCard}>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Subtotal</Text>
            <Text style={styles.detailValue}>₱{formatCurrency(amount)}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>
              {isOnlineMode ? 'Stellar Network Fee' : 'Offline Processing'}
            </Text>
            <Text style={[styles.detailValue, { color: '#10B981' }]}>₱0.00 (Waived)</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Pijin Service Fee</Text>
            <Text style={styles.detailValue}>₱{formatCurrency(fee)}</Text>
          </View>
          <View style={styles.cardSeparator} />
          <View style={styles.totalItem}>
            <Text style={styles.totalLabel}>Total Deducted</Text>
            <Text style={styles.totalValue}>₱{formatCurrency(total)}</Text>
          </View>
        </View>

        {/* Verification Checkbox Row */}
        <TouchableOpacity 
          style={styles.checkboxRow} 
          onPress={handleToggleCheckbox}
          activeOpacity={0.8}
        >
          <Ionicons 
            name={isChecked ? "checkbox" : "square-outline"} 
            size={22} 
            color={isChecked ? "#04295A" : "#64748B"} 
          />
          <Text style={[styles.checkboxText, isChecked && styles.checkboxTextChecked]}>
            I confirm that the recipient details and amount are correct
          </Text>
        </TouchableOpacity>

        {/* Swipe Slider */}
        <View style={[styles.sliderContainer, !isChecked && styles.sliderContainerDisabled]}>
          <View style={[styles.sliderTrack, !isChecked && styles.sliderTrackDisabled]}>
            {isChecked && (
              <Animated.View
                style={[
                  styles.progressTrail,
                  {
                    width: Animated.add(swipeAnim, BUTTON_WIDTH + 8),
                  },
                ]}
              />
            )}

            <Animated.Text style={[styles.swipeText, { color: textColor }]}>
              {isChecked ? "SWIPE TO AUTHORIZE" : "CONFIRM DETAILS TO SWIPE"}
            </Animated.Text>

            {isChecked && (
              <Animated.View style={[styles.chevronIconContainer, { opacity: chevronOpacity }]}>
                <Ionicons name="chevron-forward" size={20} color="#7B889B" />
              </Animated.View>
            )}
            
            {/* Animated Swipe Padlock Button */}
            <Animated.View
              style={[
                styles.sliderButton,
                !isChecked && styles.sliderButtonDisabled,
                isChecked && { transform: [{ translateX: swipeAnim }] },
              ]}
              {...panResponder.panHandlers}
            >
              <Ionicons 
                name={isChecked ? "paper-plane-outline" : "lock-closed-outline"} 
                size={22} 
                color="#FFFFFF" 
              />
            </Animated.View>
          </View>

          {/* Ripples on completion */}
          {isChecked && (
            <Animated.View
              style={[
                styles.rippleCircle,
                {
                  transform: [{ scale: rippleScale }],
                  opacity: rippleOpacity,
                },
              ]}
            />
          )}
        </View>

        {/* Footer Branding */}
        <View style={styles.footerBranding}>
          <Text style={styles.pijinLogo}>p i j i n</Text>
          <TouchableOpacity 
            onPress={() => Alert.alert('Get help', 'Support channels and FAQs are coming soon!')} 
            activeOpacity={0.7}
          >
            <Text style={styles.getHelpLink}>Get help</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Loading Overlay */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#04295A" style={styles.loadingSpinner} />
            <Text style={styles.loadingTitle}>Authorizing Transaction</Text>
            <Text style={styles.loadingSubtitle}>Signing with private key...</Text>
          </View>
        </View>
      )}

      {/* Success Modal */}
      <Modal
        visible={successVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleBackToHome}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '90%' }]}>
            {/* Close Button */}
            <TouchableOpacity onPress={handleBackToHome} style={[styles.closeModalButton, { zIndex: 10 }]} activeOpacity={0.7}>
              <Ionicons name="close-outline" size={24} color="#6B7280" />
            </TouchableOpacity>

            <ScrollView 
              style={{ width: '100%' }}
              contentContainerStyle={{ alignItems: 'center', paddingTop: 12 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Mascot Image */}
              <Image
                source={require('../../assets/success/piji-success.png')}
                style={styles.successImage}
                resizeMode="contain"
              />

              {/* Success Info */}
              <Text style={styles.successTitle}>
                {isOnlineMode ? 'Transaction Success' : 'Offline Voucher Created'}
              </Text>
              <Text style={styles.successDesc}>
                {isOnlineMode
                  ? 'Funds have been transferred and settled\ninstantly via Stellar.'
                  : 'Your offline payment voucher is ready.\nSelect your dispatch method to proceed.'}
              </Text>

              {/* Receipt Ticket Box */}
              <View style={styles.receiptTicket}>
                <View style={styles.ticketRow}>
                  <Text style={styles.ticketLabel}>Recipient</Text>
                  <Text style={styles.ticketValue}>{recipientName}</Text>
                </View>
                <View style={styles.ticketRow}>
                  <Text style={styles.ticketLabel}>Short ID</Text>
                  <Text style={styles.ticketValue}>{recipientShortId}</Text>
                </View>
                <View style={styles.ticketRow}>
                  <Text style={styles.ticketLabel}>Amount sent</Text>
                  <Text style={styles.ticketValue}>₱{formatCurrency(amount)}</Text>
                </View>
                <View style={styles.ticketRow}>
                  <Text style={styles.ticketLabel}>Service Fee</Text>
                  <Text style={styles.ticketValue}>₱{formatCurrency(fee)}</Text>
                </View>
                {isOnlineMode ? (
                  <>
                    <View style={styles.ticketRow}>
                      <Text style={styles.ticketLabel}>Ref. Number</Text>
                      <Text style={styles.ticketIdValue}>{actualTxId ? actualTxId.slice(0, 12) + '...' : txId}</Text>
                    </View>
                    <View style={styles.ticketRow}>
                      <Text style={styles.ticketLabel}>Stellar Ledger</Text>
                      <Text style={styles.ticketValue}>#{ledgerNum}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.ticketRow}>
                      <Text style={styles.ticketLabel}>Ref. Number</Text>
                      <Text style={styles.ticketValue}>Pending Dispatch</Text>
                    </View>
                    <View style={styles.ticketRow}>
                      <Text style={styles.ticketLabel}>Stellar Ledger</Text>
                      <Text style={styles.ticketValue}>Pending Dispatch</Text>
                    </View>
                  </>
                )}

                <View style={styles.ticketSeparator} />

                {/* Barcode representation */}
                <View style={styles.barcodeWrapper}>
                  <Barcode />
                  <Text style={styles.barcodeLabel}>{txId}</Text>
                </View>

                {/* Scalloped border decorations */}
                <View style={styles.scallopsWrapper}>
                  {Array.from({ length: 22 }).map((_, i) => (
                    <Svg key={i} width={18} height={10} viewBox="0 0 18 10" style={styles.scallopSvg}>
                      <Path
                        d="M 0 10 A 9 9 0 0 1 18 10"
                        fill="#04295A"
                        stroke="#04295A"
                        strokeWidth={1.5}
                      />
                    </Svg>
                  ))}
                </View>
              </View>

              {/* Back to Dashboard / Dispatch Button */}
              <TouchableOpacity onPress={handleBackToHome} style={styles.backHomeButton} activeOpacity={0.9}>
                <Ionicons name="arrow-undo-outline" size={18} color="#FFFFFF" style={styles.backHomeIcon} />
                <Text style={styles.backHomeButtonText}>
                  {isOnlineMode ? 'Back to Dashboard' : 'Select Dispatch Method'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EFF1F5',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 15,
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#000000',
  },
  amountHeroContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 18,
  },
  amountLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#707984',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  amountDisplayRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  amountSymbol: {
    fontSize: 26,
    fontWeight: '800',
    color: '#04295A',
    marginTop: 6,
    marginRight: 2,
  },
  amountValue: {
    fontSize: 48,
    fontWeight: '900',
    color: '#04295A',
    letterSpacing: -1,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 8,
  },
  greenPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  networkBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
    textTransform: 'uppercase',
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginHorizontal: 20,
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 3,
    marginBottom: 16,
  },
  partyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  partyAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E5EDF6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  partyAvatarText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#04295A',
  },
  partyDetails: {
    flex: 1,
  },
  partyLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  partyName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#04295A',
  },
  partySub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  cardSeparator: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 12,
  },
  memoContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  memoTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  memoText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
    fontStyle: 'italic',
  },
  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginHorizontal: 20,
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 3,
    marginBottom: 16,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#04295A',
  },
  totalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#04295A',
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#04295A',
  },
  securityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2E8F0',
    marginHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 10,
  },
  securityText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0F172A',
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.02,
    shadowRadius: 8,
    elevation: 1.5,
  },
  checkboxText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    marginLeft: 12,
    flex: 1,
  },
  checkboxTextChecked: {
    color: '#04295A',
  },
  sliderContainer: {
    position: 'relative',
    marginVertical: 10,
  },
  sliderContainerDisabled: {
    opacity: 0.8,
  },
  sliderTrack: {
    height: 64,
    backgroundColor: '#E5EDF6',
    borderRadius: 32,
    marginHorizontal: 20,
    paddingHorizontal: 4,
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 1.5,
    borderColor: '#D2E1F1',
    overflow: 'hidden',
  },
  sliderTrackDisabled: {
    backgroundColor: '#E2E8F0',
    borderColor: '#CBD5E1',
  },
  progressTrail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#04295A',
    borderRadius: 30,
  },
  swipeText: {
    position: 'absolute',
    alignSelf: 'center',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  chevronIconContainer: {
    position: 'absolute',
    right: 22,
  },
  sliderButton: {
    width: BUTTON_WIDTH,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#04295A',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    left: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  sliderButtonDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  rippleCircle: {
    position: 'absolute',
    left: MAX_SWIPE + 24,
    top: 4,
    width: BUTTON_WIDTH,
    height: BUTTON_WIDTH,
    borderRadius: BUTTON_WIDTH / 2,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    pointerEvents: 'none',
  },
  footerBranding: {
    alignItems: 'center',
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#E6E9EE',
    marginHorizontal: 20,
    paddingTop: 14,
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
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  loadingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '80%',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
  },
  loadingSpinner: {
    marginBottom: 16,
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#04295A',
    marginBottom: 4,
  },
  loadingSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#707984',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    width: '100%',
    padding: 24,
    alignItems: 'center',
    position: 'relative',
  },
  closeModalButton: {
    position: 'absolute',
    top: 20,
    right: 20,
  },
  successImage: {
    width: SCREEN_WIDTH * 0.45,
    height: SCREEN_WIDTH * 0.35,
    marginVertical: 5,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#04295A',
    marginBottom: 8,
    textAlign: 'center',
  },
  successDesc: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#707984',
    textAlign: 'center',
    marginBottom: 16,
  },
  receiptTicket: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: '#04295A',
    borderRadius: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
    padding: 16,
    backgroundColor: '#FFFFFF',
    position: 'relative',
    marginBottom: 35,
  },
  ticketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  ticketLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  ticketValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#04295A',
  },
  ticketIdValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#04295A',
  },
  ticketSeparator: {
    height: 1.5,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: 14,
    borderRadius: 1,
  },
  barcodeWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  barcodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
  },
  barcodeBar: {
    height: '100%',
    backgroundColor: '#0F172A',
  },
  barcodeLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 6,
    letterSpacing: 2,
  },
  scallopsWrapper: {
    position: 'absolute',
    bottom: -9.5,
    left: -1.5,
    right: -1.5,
    height: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scallopSvg: {
    marginHorizontal: -0.2,
  },
  backHomeButton: {
    backgroundColor: '#04295A',
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 10,
  },
  backHomeIcon: {
    marginRight: 8,
  },
  backHomeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
