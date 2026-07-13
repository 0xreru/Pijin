import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  TextInput,
  Animated,
  PanResponder,
  Modal,
  Dimensions,
  StatusBar,
  DeviceEventEmitter,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';
import { useAuth } from '../context/AuthContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BUTTON_WIDTH = 52;
const TRACK_WIDTH = SCREEN_WIDTH - 40;
const MAX_SWIPE = TRACK_WIDTH - BUTTON_WIDTH - 8;
const STROOPS_PER_UNIT = 10_000_000;

function stringifyForWithdrawLog(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;

  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, innerValue) => {
        if (typeof innerValue === 'bigint') return innerValue.toString();
        if (typeof innerValue === 'function') return `[Function ${innerValue.name || 'anonymous'}]`;
        if (innerValue && typeof innerValue === 'object') {
          if (seen.has(innerValue)) return '[Circular]';
          seen.add(innerValue);
        }
        return innerValue;
      },
      2
    );
  } catch {
    return String(value);
  }
}

function pickDeepWithdrawError(err: any): unknown {
  return (
    err?.simulation?.error ??
    err?.simulation ??
    err?.response?.data?.extras?.result_codes ??
    err?.response?.data?.extras ??
    err?.response?.data ??
    err?.extras?.result_codes ??
    err?.extras ??
    err?.sendTransactionResponse?.errorResult ??
    err?.sendTransactionResponse ??
    err?.result_codes ??
    err?.error ??
    err?.message ??
    err
  );
}

function extractWithdrawError(err: unknown): string {
  const extracted = pickDeepWithdrawError(err);
  const rendered = stringifyForWithdrawLog(extracted);
  const fallback = stringifyForWithdrawLog(err);

  if (rendered && rendered !== '{}' && rendered !== 'undefined') {
    return rendered;
  }
  if (fallback && fallback !== '{}' && fallback !== 'undefined') {
    return fallback;
  }
  return 'Unknown Soroban withdraw failure. Check Metro logs for the raw error object.';
}

function amountToStroops(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid deposit amount: ${amount}`);
  }
  return BigInt(Math.round(amount * STROOPS_PER_UNIT));
}

async function executeWithdraw(input: { customerPublicKey: string; amount: number }): Promise<string | undefined> {
  const startedAt = Date.now();
  const markStage = (stage: string, details?: unknown): void => {
    const suffix = details === undefined ? '' : ` details=${stringifyForWithdrawLog(details)}`;
    console.log(`[withdraw] stage=${stage} elapsedMs=${Date.now() - startedAt}${suffix}`);
  };

  const { Keypair, StrKey, TransactionBuilder } = require('@stellar/stellar-sdk');
  const { getMainWalletSecret } = require('../services/storage/onboardingStorage');

  // ── 1. Load main wallet ────────────────────────────────────────────────────
  markStage('load-main-wallet');
  const mainWalletSecret = await getMainWalletSecret();
  if (!mainWalletSecret) {
    throw new Error('No main wallet secret found in SecureStore.');
  }

  const mainWalletKeypair = Keypair.fromSecret(mainWalletSecret);
  const mainWalletPublicKey = mainWalletKeypair.publicKey();
  if (mainWalletPublicKey !== input.customerPublicKey) {
    throw new Error(
      `Main wallet mismatch. Active account is ${input.customerPublicKey}, but SecureStore main wallet is ${mainWalletPublicKey}.`
    );
  }

  // ── 2. Convert amount to stroops ───────────────────────────────────────────
  const amountStroops = amountToStroops(input.amount).toString();
  markStage('build-params', { customer: input.customerPublicKey, amountStroops });

  // ── 3. Sign canonical message for backend authentication ───────────────────
  markStage('sign-auth');
  const canonicalMessage = `withdraw:${mainWalletPublicKey}:${amountStroops}`;
  const sigBuffer = mainWalletKeypair.sign(Buffer.from(canonicalMessage));
  const sigBase64 = Buffer.from(sigBuffer).toString('base64');

  // ── 4. POST to backend to simulate & assemble the transaction XDR ─────────
  markStage('assemble-via-backend');
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/^['"]|['"]$/g, '');
  const tokenAddress = process.env.EXPO_PUBLIC_TOKEN_ID?.trim().replace(/^['"]|['"]$/g, '');
  const rpcUrl = process.env.EXPO_PUBLIC_SOROBAN_RPC_URL?.trim().replace(/^['"]|['"]$/g, '');
  const networkPassphrase = process.env.EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE?.trim().replace(/^['"]|['"]$/g, '');

  if (!apiBase) throw new Error('Missing EXPO_PUBLIC_API_BASE_URL in apps/mobile/.env');
  if (!tokenAddress) throw new Error('Missing EXPO_PUBLIC_TOKEN_ID in apps/mobile/.env');
  if (!rpcUrl) throw new Error('Missing EXPO_PUBLIC_SOROBAN_RPC_URL in apps/mobile/.env');
  if (!networkPassphrase) throw new Error('Missing EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE in apps/mobile/.env');

  let assembleResponse: Response;
  try {
    assembleResponse = await fetch(`${apiBase}/api/engine/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sigBase64}`,
      },
      body: JSON.stringify({
        senderPublicKey: mainWalletPublicKey,
        tokenAddress,
        amountStroops,
      }),
    });
  } catch (err) {
    throw new Error(`Network error contacting withdraw API: ${String(err)}`);
  }

  const assembleData = await assembleResponse.json().catch(() => ({}));
  if (!assembleResponse.ok) {
    const reason = (assembleData as any)?.error ?? `HTTP ${assembleResponse.status}`;
    console.error('[withdraw] backend assembly error:', reason);
    throw new Error(`Withdraw failed: ${reason}`);
  }

  const xdr: string | undefined = (assembleData as any)?.xdr;
  if (!xdr) {
    throw new Error('Backend did not return an XDR envelope');
  }
  markStage('assemble-done');

  // ── 6. Sign the assembled XDR with the sender's main wallet key ───────────
  //
  // The deposit transaction source account IS the sender, so Stellar requires
  // the sender's Ed25519 signature — not the relayer's. We use the main wallet
  // keypair that is stored locally in SecureStore.
  //
  markStage('sign-xdr');
  let signedXdrBase64: string;
  try {
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
    signedXdrBase64 = Buffer.from(bytes).toString('base64');
  } catch (err) {
    throw new Error(`Failed to sign XDR: ${String(err)}`);
  }

  // ── 7. Submit signed transaction directly to Soroban RPC ─────────────────
  //
  // We use a raw JSON-RPC fetch instead of rpc.Server to avoid any potential
  // React Native / Hermes compatibility issues with the SDK's HTTP client.
  //
  markStage('submit');
  let txHash: string | undefined;
  try {
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
    if (sendData.error) {
      throw new Error(sendData.error.message ?? JSON.stringify(sendData.error));
    }
    if (sendData.result?.status === 'ERROR') {
      throw new Error(`Sending the transaction to the network failed!\n${JSON.stringify(sendData.result, null, 2)}`);
    }
    txHash = sendData.result?.hash;
    markStage('submit-success', { txHash });
  } catch (err) {
    throw new Error(`Transaction submission failed: ${String(err)}`);
  }

  // ── 8. Poll for on-chain confirmation ─────────────────────────────────────
  if (txHash) {
    markStage('wait-confirmation', { txHash });
    const maxAttempts = 15;
    const intervalMs = 2000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
      try {
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
        const status: string | undefined = pollData.result?.status;
        if (status === 'SUCCESS') {
          markStage('confirmed', { txHash });
          break;
        }
        if (status === 'FAILED') {
          throw new Error(`On-chain transaction FAILED. Hash: ${txHash}`);
        }
        // status === 'NOT_FOUND' → still pending, keep polling
      } catch (pollErr) {
        // Don't abort polling on a single transient network error
        console.warn(`[withdraw] poll attempt ${attempt + 1} error:`, pollErr);
      }
    }
  }

  markStage('complete', { txHash });
  return txHash;
}


export function LoadOnlineFundsScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { activeAccount } = useAuth();
  const { balance } = route.params || { balance: 25000 };

  // States
  const [inputText, setInputText] = useState('');
  const [numericVal, setNumericVal] = useState(0);
  const numericValRef = useRef(0);
  const [formattedAmount, setFormattedAmount] = useState('0.00');
  const [isLoading, setIsLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const isProcessingRef = useRef(false);
  const [txId] = useState(() => {
    // Generate a random 16-digit transaction ID
    let id = '';
    for (let i = 0; i < 16; i++) {
      id += Math.floor(Math.random() * 10).toString();
    }
    return id;
  });

  // Swipe Animation states
  const swipeAnim = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  // Ripple Animation states
  const rippleScale1 = useRef(new Animated.Value(0.5)).current;
  const rippleOpacity1 = useRef(new Animated.Value(0)).current;
  const rippleScale2 = useRef(new Animated.Value(0.5)).current;
  const rippleOpacity2 = useRef(new Animated.Value(0)).current;

  const textColor = swipeAnim.interpolate({
    inputRange: [0, MAX_SWIPE * 0.4, MAX_SWIPE * 0.75],
    outputRange: ['#8999B0', '#8999B0', '#FFFFFF'],
  });

  const chevronOpacity = swipeAnim.interpolate({
    inputRange: [0, MAX_SWIPE * 0.6],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  // PanResponder for interactive slider
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt, gestureState) => {
        // Only allow swiping right, capped at MAX_SWIPE
        let newX = gestureState.dx;
        if (newX < 0) newX = 0;
        if (newX > MAX_SWIPE) newX = MAX_SWIPE;
        swipeAnim.setValue(newX);
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx >= MAX_SWIPE * 0.85) {
          const currentAmount = numericValRef.current;
          // Snap to end and trigger success modal if amount is valid
          if (currentAmount < 50 || currentAmount > 50000) {
            // Slide back slowly if invalid amount
            Animated.timing(swipeAnim, {
              toValue: 0,
              duration: 350,
              useNativeDriver: false,
            }).start();
            alert('Please enter an amount between ₱50.00 and ₱50,000.00');
          } else {
            Animated.timing(swipeAnim, {
              toValue: MAX_SWIPE,
              duration: 120,
              useNativeDriver: false,
            }).start(() => {
              // Trigger staggered concentric ripples
              rippleScale1.setValue(0.5);
              rippleOpacity1.setValue(1);
              rippleScale2.setValue(0.5);
              rippleOpacity2.setValue(1);

              Animated.parallel([
                Animated.timing(rippleScale1, {
                  toValue: 4,
                  duration: 600,
                  useNativeDriver: false,
                }),
                Animated.timing(rippleOpacity1, {
                  toValue: 0,
                  duration: 600,
                  useNativeDriver: false,
                }),
                Animated.sequence([
                  Animated.delay(120),
                  Animated.parallel([
                    Animated.timing(rippleScale2, {
                      toValue: 3.5,
                      duration: 480,
                      useNativeDriver: false,
                    }),
                    Animated.timing(rippleOpacity2, {
                      toValue: 0,
                      duration: 480,
                      useNativeDriver: false,
                    }),
                  ]),
                ]),
              ]).start(async () => {
                setIsLoading(true);
                swipeAnim.setValue(0);

                try {
                  if (!activeAccount?.stellarPublicKey) {
                    throw new Error('No active account public key found.');
                  }

                  await executeWithdraw({
                    customerPublicKey: activeAccount.stellarPublicKey,
                    amount: currentAmount,
                  });

                  setIsLoading(false);
                  setModalVisible(true);
                } catch (err: any) {
                  const extractedError = extractWithdrawError(err);
                  console.error('[withdraw] failed raw=', err);
                  console.error('[withdraw] failed extracted=', extractedError);
                  setIsLoading(false);
                  Alert.alert('Withdraw Failed', extractedError);
                  Animated.timing(swipeAnim, {
                    toValue: 0,
                    duration: 350,
                    useNativeDriver: false,
                  }).start();
                }
              });
            });
          }
        } else {
          // Slide back slowly to start
          Animated.timing(swipeAnim, {
            toValue: 0,
            duration: 350,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  // Handle keypad entry for standard banking input (shifting decimals)
  const handleAmountChange = (text: string) => {
    const digitsOnly = text.replace(/[^0-9]/g, '');
    if (!digitsOnly) {
      setNumericVal(0);
      numericValRef.current = 0;
      setFormattedAmount('0.00');
      setInputText('');
      return;
    }
    const num = parseInt(digitsOnly, 10) / 100;
    setNumericVal(num);
    numericValRef.current = num;
    setFormattedAmount(
      num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    setInputText(digitsOnly);
  };

  const handleBackToHome = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    setModalVisible(false);
    
    try {
      const { addTransactions } = require('../db/services/transactionDb');
      await addTransactions([
        {
          title: 'Offline to Online Transfer',
          amount: -numericVal,
          type: 'transfer',
          tag: 'OFFLINE',
          description: `Moved ₱${numericVal.toFixed(2)} from offline vault to online wallet.`,
          stellarPublicKey: activeAccount?.stellarPublicKey,
          shortId: activeAccount?.shortId,
        },
        {
          title: 'Received from Offline Vault',
          amount: numericVal,
          type: 'transfer',
          tag: 'WALLET',
          description: `Received ₱${numericVal.toFixed(2)} from offline vault.`,
          stellarPublicKey: activeAccount?.stellarPublicKey,
          shortId: activeAccount?.shortId,
        },
      ]);
      // Emit event to deduct offline balance and add to online balance
      DeviceEventEmitter.emit('ON_LOAD_ONLINE_FUNDS', numericVal);
      // Trigger polling on DashboardScreen (same event as deposit so it updates the same way)
      DeviceEventEmitter.emit('ON_DEPOSIT_COMPLETE');
    } catch (err) {
      console.error('Failed to log load online funds transaction:', err);
    } finally {
      isProcessingRef.current = false;
    }

    navigation.goBack();
  };



  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}>
      <StatusBar barStyle="dark-content" />

      <ConnectionWatcher navigation={navigation} currentMode="online" />

      {/* Header Row */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
          <Ionicons name="arrow-undo-outline" size={28} color="#000000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          Offline vault to{'\n'}Online wallet
        </Text>
      </View>

      {/* Enter Amount Card */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => inputRef.current?.focus()}
        style={styles.cardWrapper}
      >
        {/* Wifi Offline Overlaid Badge */}
        <View style={styles.wifiBadgeContainer}>
          <View style={styles.wifiBadge}>
            <Ionicons name="wifi-outline" size={20} color="#000000" />
            <View style={styles.wifiSlash} />
          </View>
        </View>

        <Text style={styles.enterAmountText}>Enter Amount</Text>
        <View style={styles.amountInputRow}>
          <Text style={styles.currencyLabel}>PHP</Text>
          <Text style={styles.amountDisplay}>{formattedAmount}</Text>
        </View>
        <View style={styles.inputUnderline} />

        {/* Hidden TextInput for keyboard interaction */}
        <TextInput
          ref={inputRef}
          keyboardType="number-pad"
          value={inputText}
          onChangeText={handleAmountChange}
          style={styles.hiddenInput}
          caretHidden
        />
      </TouchableOpacity>

      {/* Info texts */}
      <Text style={styles.rangeText}>From ₱50.00 up to ₱50,000.00 only</Text>

      <View style={styles.disclaimerContainer}>
        <Ionicons name="information-circle-outline" size={16} color="#707984" style={styles.infoIcon} />
        <Text style={styles.disclaimerText}>
          Please note: This balance will only be available for face-to-face or offline transactions and cannot be used for online payments.
        </Text>
      </View>

      {/* Mascot illustration */}
      <View style={styles.mascotContainer}>
        <Image
          source={require('../../assets/offline funds/piji-cashin.png')}
          style={styles.mascotImage}
          resizeMode="contain"
        />
      </View>

      {/* Swipe Slider Container wrapper */}
      <View style={styles.sliderContainer}>
        {/* Swipe Slider Track */}
        <View style={styles.sliderTrack}>
          {/* Animated Progress Trail */}
          <Animated.View
            style={[
              styles.progressTrail,
              {
                width: Animated.add(swipeAnim, BUTTON_WIDTH + 8),
              },
            ]}
          />

          <Animated.Text style={[styles.swipeText, { color: textColor }]}>
            SWIPE TO FUND
          </Animated.Text>

          <Animated.View style={[styles.chevronIconContainer, { opacity: chevronOpacity }]}>
            <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
          </Animated.View>
          
          {/* Animated Swipe Padlock Button */}
          <Animated.View
            style={[
              styles.sliderButton,
              {
                transform: [{ translateX: swipeAnim }],
              },
            ]}
            {...panResponder.panHandlers}
          >
            <Ionicons name="lock-closed-outline" size={20} color="#FFFFFF" />
          </Animated.View>
        </View>

        {/* Dynamic Water Ripples */}
        <Animated.View
          style={[
            styles.rippleCircle,
            {
              transform: [{ scale: rippleScale1 }],
              opacity: rippleOpacity1,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.rippleCircle,
            {
              transform: [{ scale: rippleScale2 }],
              opacity: rippleOpacity2,
            },
          ]}
        />
      </View>

      {/* Footer */}
      <View style={styles.footerContainer}>
        <Text style={styles.pijinLogo}>p i j i n</Text>
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={styles.getHelpLink}>Get help</Text>
        </TouchableOpacity>
      </View>

      {/* Loading Overlay */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#04295A" style={styles.loadingSpinner} />
            <Text style={styles.loadingTitle}>Processing Transfer</Text>
            <Text style={styles.loadingSubtitle}>Securing offline funds...</Text>
          </View>
        </View>
      )}

      {/* Success Modal */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleBackToHome}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Close Button */}
            <TouchableOpacity onPress={handleBackToHome} style={styles.closeModalButton} activeOpacity={0.7}>
              <Ionicons name="close-outline" size={24} color="#6B7280" />
            </TouchableOpacity>

            {/* Mascot Image */}
            <Image
              source={require('../../assets/success/piji-success.png')}
              style={styles.successImage}
              resizeMode="contain"
            />

            {/* Success Info */}
            <Text style={styles.successTitle}>Transfer successful</Text>
            <Text style={styles.successDesc}>
              Thank you! Your transfer was successfully{'\n'}processed
            </Text>

            {/* Receipt Ticket Box */}
            <View style={styles.receiptTicket}>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Transfer amount</Text>
                <Text style={styles.ticketValue}>₱{formattedAmount}</Text>
              </View>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Transaction ID</Text>
                <Text style={styles.ticketIdValue}>{txId}</Text>
              </View>

              {/* Scalloped overlay pattern container at the bottom */}
              <View style={styles.scallopsWrapper}>
                {Array.from({ length: 22 }).map((_, i) => (
                  <Svg key={i} width={18} height={10} viewBox="0 0 18 10" style={styles.scallopSvg}>
                    <Path
                      d="M 0 10 A 9 9 0 0 1 18 10"
                      fill="#EFF1F5"
                      stroke="#04295A"
                      strokeWidth={1.5}
                    />
                  </Svg>
                ))}
              </View>
            </View>

            {/* Back to Home Button */}
            <TouchableOpacity onPress={handleBackToHome} style={styles.backHomeButton} activeOpacity={0.9}>
              <Ionicons name="arrow-undo-outline" size={18} color="#FFFFFF" style={styles.backHomeIcon} />
              <Text style={styles.backHomeButtonText}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: SCREEN_HEIGHT,
    backgroundColor: '#EFF1F5',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  backButton: {
    marginRight: 16,
    marginTop: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#000000',
    lineHeight: 28,
  },
  cardWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 20,
    marginHorizontal: 20,
    marginTop: 20,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    position: 'relative',
  },
  wifiBadgeContainer: {
    position: 'absolute',
    top: -20,
    alignSelf: 'center',
  },
  wifiBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    position: 'relative',
  },
  wifiSlash: {
    position: 'absolute',
    width: 2,
    height: 20,
    backgroundColor: '#000000',
    transform: [{ rotate: '45deg' }],
  },
  enterAmountText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#000000',
    marginTop: 10,
    marginBottom: 16,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  currencyLabel: {
    fontSize: 22,
    fontWeight: '900',
    color: '#000000',
    marginRight: 6,
  },
  amountDisplay: {
    fontSize: 32,
    fontWeight: '900',
    color: '#7C8A9B', // Gray color like screenshot
  },
  inputUnderline: {
    height: 1,
    backgroundColor: '#707984',
    width: '85%',
    marginTop: 8,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 0,
    height: 0,
  },
  rangeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 12,
  },
  disclaimerContainer: {
    flexDirection: 'row',
    paddingHorizontal: 28,
    marginTop: 16,
    alignItems: 'flex-start',
  },
  infoIcon: {
    marginRight: 6,
    marginTop: 1,
  },
  disclaimerText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    color: '#707984',
    flex: 1,
    textAlign: 'center',
  },
  mascotContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 15,
  },
  mascotImage: {
    width: SCREEN_WIDTH * 0.75,
    height: SCREEN_WIDTH * 0.55,
  },
  sliderContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  sliderTrack: {
    height: 60,
    backgroundColor: '#E5EDF6',
    borderRadius: 30,
    marginHorizontal: 20,
    paddingHorizontal: 4,
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 1.5,
    borderColor: '#D2E1F1',
    overflow: 'hidden', // Make sure trail respects track borders
  },
  rippleCircle: {
    position: 'absolute',
    left: MAX_SWIPE + 24, // Align with center position of padlock button at end
    top: 4,
    width: BUTTON_WIDTH,
    height: BUTTON_WIDTH,
    borderRadius: BUTTON_WIDTH / 2,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    pointerEvents: 'none',
  },
  progressTrail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#04295A',
    borderRadius: 28,
  },
  swipeText: {
    position: 'absolute',
    alignSelf: 'center',
    fontSize: 15,
    fontWeight: '800',
    color: '#8999B0',
    letterSpacing: 1.5,
  },
  chevronIconContainer: {
    position: 'absolute',
    right: 20,
  },
  sliderButton: {
    width: BUTTON_WIDTH,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#04295A',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    left: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  footerContainer: {
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
  },
  getHelpLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#04295A',
    textDecorationLine: 'underline',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
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
    width: SCREEN_WIDTH * 0.55,
    height: SCREEN_WIDTH * 0.4,
    marginVertical: 10,
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
    marginBottom: 20,
  },
  receiptTicket: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: '#04295A',
    borderRadius: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
    padding: 18,
    backgroundColor: '#FFFFFF',
    position: 'relative',
    marginBottom: 35,
  },
  ticketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  ticketLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  ticketValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#04295A',
  },
  ticketIdValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#04295A',
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
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
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
});
