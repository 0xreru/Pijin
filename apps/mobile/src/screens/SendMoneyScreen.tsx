import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Image,
  Dimensions,
  StatusBar,
  Alert,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureMigration } from '../services/storage/migration';
import { useAuth } from '../context/AuthContext';
import { useVaultBalance } from '../hooks/useVaultBalance';
import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';
import { connectionService } from '../services/connectionService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CACHED_BALANCE_KEY = 'pijn.cached_balance';
const API_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://pijin-api.vercel.app';
const SHORT_ID_PATTERN = /^[0-9A-Za-z]{6}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecipientInfo = {
  shortId: string;
  stellarPublicKey: string;
  offlineDeviceKey: string | null;
  displayName: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SendMoneyScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { activeAccount } = useAuth();

  // Balance state
  const [isOnline, setIsOnline] = useState(true);
  const [walletBalance, setWalletBalance] = useState<number>(25000.00);

  // Form states
  const [recipientShortId, setRecipientShortId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  // Resolved recipient (fetched from the backend)
  const [resolvedRecipient, setResolvedRecipient] = useState<RecipientInfo | null>(null);

  // Error states
  const [recipientShortIdError, setRecipientShortIdError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);

  // Search modal state
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<RecipientInfo | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Fetch cached balance on mount and subscribe to network state
  useEffect(() => {
    const getCached = async () => {
      try {
        await ensureMigration();
        const onlineStr = await AsyncStorage.getItem('pijn.is_online');
        const online = onlineStr !== 'false';

        const key = online ? CACHED_BALANCE_KEY : 'pijn.offline_balance';
        const stored = await AsyncStorage.getItem(key);
        if (stored) {
          setWalletBalance(parseFloat(stored));
        } else {
          setWalletBalance(online ? 25000.00 : 0.00);
        }
      } catch (e) {
        console.warn('Failed to load cached balance in SendMoney:', e);
      }
    };
    getCached();
    
    const sub = connectionService.state$.subscribe((state) => {
      setIsOnline(state.isOnlineMode);
    });
    return () => sub.unsubscribe();
  }, []);

  // Prefill scanned QR data
  useEffect(() => {
    const rxShortId = route?.params?.recipientShortId;
    if (rxShortId) {
      setRecipientShortId(rxShortId);
      // If also passed with a known key from QR, prefill resolved recipient
      if (route?.params?.receiverPubKey) {
        setResolvedRecipient({
          shortId: rxShortId,
          stellarPublicKey: route.params.receiverPubKey,
          offlineDeviceKey: route.params.offlineDeviceKey ?? null,
          displayName: route.params.recipientName ?? rxShortId,
        });
      }
    } else {
      const qrData = route?.params?.qrData;
      if (qrData) {
        const parts = qrData.split(':');
        if (parts[0]) {
          setRecipientShortId(parts[0]);
        }
        if (parts[1]) {
          const parsedAmount = parseFloat(parts[1]);
          if (!isNaN(parsedAmount) && parsedAmount > 0) {
            setAmount(parts[1]);
          }
        }
        if (parts[2]) {
          setNote(parts[2]);
        }
      }
    }
  }, [route?.params?.recipientShortId, route?.params?.qrData]);

  const isPrefilledFromQR = !!(route?.params?.isScanned || route?.params?.recipientShortId || route?.params?.qrData);

  // Fetch live balance (only if online)
  const { balancePhp } = useVaultBalance(activeAccount?.shortId, activeAccount?.stellarPublicKey);
  const currentBalance = (isOnline && balancePhp !== null) ? balancePhp : walletBalance;

  // Format currency
  const formatCurrency = (val: number) => {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // ── Live lookup: call /api/users/lookup?shortId=… ─────────────────────────
  const lookupRecipient = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) {
      setSearchResult(null);
      setSearchError(null);
      return;
    }
    setIsSearching(true);
    setSearchError(null);
    setSearchResult(null);
    try {
      const isPhone = /^\d+$/.test(q) && q.length >= 7;
      const paramKey = isPhone ? 'phone' : 'shortId';

      if (!isOnline) {
        if (isPhone) {
          setSearchError('Phone number lookup requires an internet connection.');
          return;
        }
        if (!SHORT_ID_PATTERN.test(q)) {
          setSearchError('Enter the exact 6-character, case-sensitive Short ID.');
          return;
        }
        setSearchResult({
          shortId: q,
          stellarPublicKey: '',
          offlineDeviceKey: null,
          displayName: q,
        });
        return;
      }

      const res = await fetch(`${API_URL}/api/users/lookup?${paramKey}=${encodeURIComponent(q)}`);
      if (res.status === 404) {
        setSearchError('No account found with that Short ID or phone number.');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? `Lookup failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (!data.found) {
        setSearchError('No account found with that Short ID or phone number.');
        return;
      }
      setSearchResult({
        shortId: data.shortId,
        stellarPublicKey: data.stellarPublicKey,
        offlineDeviceKey: data.offlineDeviceKey ?? null,
        displayName: data.displayName,
      });
    } catch (e: any) {
      console.error('[SendMoney] Recipient lookup error:', e);
      setSearchError(e?.message ?? 'Failed to look up recipient. Check your connection.');
    } finally {
      setIsSearching(false);
    }
  }, [isOnline]);

  const handleSearchConfirm = () => {
    if (!searchResult) return;
    setResolvedRecipient(searchResult);
    setRecipientShortId(searchResult.shortId);
    setRecipientShortIdError(null);
    setSearchModalVisible(false);
    setSearchQuery('');
    setSearchResult(null);
  };

  const handleContinue = async () => {
    if (isResolving) return;
    
    let currentRecipient = resolvedRecipient;
    const normalizedRecipientId = recipientShortId.trim();

    // Validate recipient
    if (!normalizedRecipientId) {
      setRecipientShortIdError('Recipient Short ID is required');
      return;
    } 

    // An offline lookup deliberately has no public key. If connectivity is
    // restored while this screen is open, refresh that stale recipient before
    // opening an online confirmation.
    const needsRecipientLookup =
      !currentRecipient ||
      currentRecipient.shortId !== normalizedRecipientId ||
      (isOnline && !currentRecipient.stellarPublicKey.trim());

    if (needsRecipientLookup) {
      setIsResolving(true);
      try {
        const q = normalizedRecipientId;
        const isPhone = /^\d+$/.test(q) && q.length >= 7;
        
        if (!isOnline) {
          if (isPhone) {
            setRecipientShortIdError('Phone number lookup requires an internet connection.');
            setIsResolving(false);
            return;
          }
          if (!SHORT_ID_PATTERN.test(q)) {
            setRecipientShortIdError('Enter the exact 6-character, case-sensitive Short ID.');
            setIsResolving(false);
            return;
          }
          currentRecipient = {
            shortId: q,
            stellarPublicKey: '',
            offlineDeviceKey: null,
            displayName: q,
          };
          setResolvedRecipient(currentRecipient);
        } else {
          // Online lookup
          const paramKey = isPhone ? 'phone' : 'shortId';
          const res = await fetch(`${API_URL}/api/users/lookup?${paramKey}=${encodeURIComponent(q)}`);
          if (res.status === 404 || !res.ok) {
            setRecipientShortIdError('No account found with that Short ID or phone number.');
            setIsResolving(false);
            return;
          }
          const data = await res.json();
          if (!data.found) {
            setRecipientShortIdError('No account found with that Short ID or phone number.');
            setIsResolving(false);
            return;
          }
          currentRecipient = {
            shortId: data.shortId,
            stellarPublicKey: data.stellarPublicKey,
            offlineDeviceKey: data.offlineDeviceKey ?? null,
            displayName: data.displayName,
          };
          setResolvedRecipient(currentRecipient);
        }
      } catch (err) {
        setRecipientShortIdError('Failed to look up recipient. Check your connection.');
        setIsResolving(false);
        return;
      }
      setIsResolving(false);
    }

    if (!currentRecipient) {
      setRecipientShortIdError('No account found with that Short ID or phone number.');
      return;
    }

    if (isOnline && !currentRecipient.stellarPublicKey.trim()) {
      setRecipientShortIdError('Recipient public key could not be resolved. Please try again.');
      return;
    }
    
    setRecipientShortIdError(null);

    // Validate amount
    const numAmount = parseFloat(amount);
    if (!amount.trim() || isNaN(numAmount) || numAmount <= 0) {
      setAmountError('Please enter a valid amount');
      return;
    } else if (numAmount + 0.50 > currentBalance) {
      setAmountError('Insufficient balance (including ₱0.50 fee)');
      return;
    } else {
      setAmountError(null);
    }

    // Navigate to confirmation
    navigation.navigate('SendMoneyConfirm', {
      recipientShortId: currentRecipient.shortId,
      recipientName: currentRecipient.displayName,
      receiverPubKey: currentRecipient.stellarPublicKey,
      recipientVerified: Boolean(currentRecipient.stellarPublicKey),
      offlineDeviceKey: currentRecipient.offlineDeviceKey,
      amount: numAmount,
      note: note.trim(),
    });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
        <StatusBar barStyle="dark-content" />

        <ConnectionWatcher navigation={navigation} currentMode={isOnline ? 'online' : 'offline'} />

        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-undo-outline" size={28} color="#04295A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Send money</Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Short ID Input */}
          <View style={styles.fieldWrapper}>
            <View style={[
              styles.inputContainer,
              isPrefilledFromQR && styles.disabledInputContainer
            ]}>
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>Short ID</Text>
              </View>
              <View style={styles.inputRow}>
                <TextInput
                  style={[
                    styles.textInput,
                    isPrefilledFromQR && styles.disabledTextInput
                  ]}
                  placeholder="Enter Short ID or phone…"
                  placeholderTextColor="#8C98A6"
                  value={recipientShortId}
                  onChangeText={(text) => {
                    setRecipientShortId(text);
                    if (resolvedRecipient) setResolvedRecipient(null);
                    if (recipientShortIdError) setRecipientShortIdError(null);
                  }}
                  editable={!isPrefilledFromQR}
                  selectTextOnFocus={!isPrefilledFromQR}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {isPrefilledFromQR ? (
                  <View style={styles.iconContainer}>
                    <Ionicons name="lock-closed-outline" size={20} color="#8C98A6" />
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => {
                      setSearchQuery('');
                      setSearchResult(null);
                      setSearchError(null);
                      setSearchModalVisible(true);
                    }}
                    style={styles.iconButton}
                    activeOpacity={0.7}
                    id="btn-search-recipient"
                  >
                    <Ionicons name="search-outline" size={22} color="#04295A" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {resolvedRecipient && !recipientShortIdError && (
              <Text style={{ color: '#10B981', fontSize: 12, fontWeight: '700', marginLeft: 16, marginTop: 6 }}>
                {resolvedRecipient.stellarPublicKey ? '✓ Verified: ' : 'Unverified offline: '}{resolvedRecipient.displayName}
              </Text>
            )}
            {recipientShortIdError && (
              <Text style={styles.errorText}>{recipientShortIdError}</Text>
            )}
          </View>

          {/* Amount Input */}
          <View style={styles.fieldWrapper}>
            <View style={styles.inputContainer}>
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>Amount</Text>
              </View>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Enter amount"
                  placeholderTextColor="#8C98A6"
                  value={amount}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9.]/g, '');
                    setAmount(cleaned);
                    if (amountError) setAmountError(null);
                  }}
                  keyboardType="decimal-pad"
                />
                <View style={styles.iconContainer}>
                  <Ionicons name="cash-outline" size={22} color="#04295A" />
                </View>
              </View>
            </View>
            {amountError ? (
              <Text style={styles.errorText}>{amountError}</Text>
            ) : (
              <Text style={styles.helperText}>
                You have ₱{formatCurrency(currentBalance)} in your wallet
              </Text>
            )}
          </View>

          {/* Note Input */}
          <View style={styles.fieldWrapper}>
            <View style={styles.inputContainer}>
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>Note</Text>
              </View>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="(Optional)"
                  placeholderTextColor="#8C98A6"
                  value={note}
                  onChangeText={setNote}
                />
                <View style={styles.iconContainer}>
                  <Ionicons name="document-text-outline" size={22} color="#04295A" />
                </View>
              </View>
            </View>
          </View>

          {/* Service Fee Info Banner */}
          <View style={styles.feeDisclaimer}>
            <Ionicons name="information-circle-outline" size={16} color="#707984" />
            <Text style={styles.feeDisclaimerText}>
              Please note that a ₱0.50 service fee will be deducted.
            </Text>
          </View>

          {/* Continue Button */}
          <TouchableOpacity
            style={styles.continueButton}
            onPress={handleContinue}
            activeOpacity={0.8}
            id="btn-send-money-continue"
          >
            <Text style={styles.continueButtonText}>
              {isResolving ? 'Resolving...' : 'Continue  →'}
            </Text>
          </TouchableOpacity>

          {/* Bottom Mascot Illustration */}
          <View style={styles.mascotContainer}>
            <Image
              source={require('../../assets/send money/piji-send.png')}
              style={styles.mascotImage}
              resizeMode="contain"
            />
          </View>

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
        </ScrollView>

        {/* ── Recipient Search Modal ─────────────────────────────────────────── */}
        <Modal
          visible={searchModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setSearchModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Find Recipient</Text>
                <TouchableOpacity
                  onPress={() => setSearchModalVisible(false)}
                  style={styles.closeButton}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close" size={24} color="#04295A" />
                </TouchableOpacity>
              </View>

              {/* Search Input */}
              <View style={styles.searchInputWrapper}>
                <Ionicons name="search-outline" size={18} color="#8C98A6" style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Short ID (e.g. PVAPqf) or phone…"
                  placeholderTextColor="#8C98A6"
                  value={searchQuery}
                  autoFocus={true}
                  onChangeText={(t) => {
                    setSearchQuery(t);
                    setSearchResult(null);
                    setSearchError(null);
                  }}
                  autoCapitalize="none"
                  returnKeyType="search"
                  onSubmitEditing={() => lookupRecipient(searchQuery)}
                />
                <TouchableOpacity
                  style={styles.searchGoButton}
                  onPress={() => lookupRecipient(searchQuery)}
                  activeOpacity={0.8}
                  id="btn-lookup-recipient"
                >
                  {isSearching
                    ? <ActivityIndicator size="small" color="#FFFFFF" />
                    : <Text style={styles.searchGoText}>Search</Text>}
                </TouchableOpacity>
              </View>

              {/* Results */}
              <ScrollView style={styles.searchResults} showsVerticalScrollIndicator={false}>
                {searchError && (
                  <View style={styles.searchErrorBox}>
                    <Ionicons name="alert-circle-outline" size={18} color="#EF4444" />
                    <Text style={styles.searchErrorText}>{searchError}</Text>
                  </View>
                )}

                {searchResult && (
                  <TouchableOpacity
                    style={styles.searchResultItem}
                    onPress={handleSearchConfirm}
                    activeOpacity={0.8}
                  >
                    <View style={styles.searchResultAvatar}>
                      <Text style={styles.searchResultAvatarText}>
                        {searchResult.displayName.slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.searchResultInfo}>
                      <Text style={styles.searchResultName}>{searchResult.displayName}</Text>
                      <Text style={styles.searchResultId}>ID: {searchResult.shortId}</Text>
                      <Text style={styles.searchResultKey} numberOfLines={1}>
                        {searchResult.stellarPublicKey.slice(0, 12)}…{searchResult.stellarPublicKey.slice(-8)}
                      </Text>
                    </View>
                    <View style={styles.searchResultSelectBadge}>
                      <Text style={styles.searchResultSelectText}>Select</Text>
                    </View>
                  </TouchableOpacity>
                )}

                {!isSearching && !searchResult && !searchError && (
                  <View style={styles.searchHint}>
                    <Ionicons name="information-circle-outline" size={18} color="#8C98A6" />
                    <Text style={styles.searchHintText}>
                      Enter a Short ID (e.g. PVAPqf) or a registered phone number
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  fieldWrapper: {
    width: '100%',
    marginBottom: 8,
  },
  inputContainer: {
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    marginTop: 20,
    height: 60,
    justifyContent: 'center',
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  disabledInputContainer: {
    backgroundColor: '#EFF1F5',
    shadowOpacity: 0,
    elevation: 0,
    borderWidth: 1,
    borderColor: '#E6E9EE',
  },
  badgeContainer: {
    position: 'absolute',
    top: -10,
    left: 20,
    backgroundColor: '#04295A',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 6,
    zIndex: 10,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#04295A',
    paddingVertical: 8,
  },
  disabledTextInput: {
    color: '#707984',
  },
  iconButton: {
    padding: 6,
  },
  iconContainer: {
    padding: 6,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 16,
    marginTop: 6,
  },
  helperText: {
    color: '#707984',
    fontSize: 11.5,
    fontWeight: '600',
    marginLeft: 16,
    marginTop: 6,
  },
  feeDisclaimer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    marginHorizontal: 16,
    width: '100%',
  },
  feeDisclaimerText: {
    color: '#707984',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  continueButton: {
    backgroundColor: '#04295A',
    height: 56,
    borderRadius: 28,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 3,
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  mascotContainer: {
    width: SCREEN_WIDTH * 0.95,
    height: (SCREEN_WIDTH * 0.95) * (640 / 960),
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 25,
    marginBottom: 5,
  },
  mascotImage: {
    width: '100%',
    height: '100%',
  },
  footerBranding: {
    alignItems: 'center',
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: '#E6E9EE',
    paddingTop: 16,
    marginTop: 10,
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
  // ── Modal ─────────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '75%',
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF1F5',
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#04295A',
  },
  closeButton: {
    padding: 4,
  },
  // ── Search Input ──────────────────────────────────────────────────────────
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF1F5',
    borderRadius: 14,
    paddingHorizontal: 12,
    marginBottom: 16,
    height: 48,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#04295A',
  },
  searchGoButton: {
    backgroundColor: '#04295A',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 70,
    alignItems: 'center',
  },
  searchGoText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  // ── Search Results ────────────────────────────────────────────────────────
  searchResults: {
    flexGrow: 0,
  },
  searchErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  searchErrorText: {
    flex: 1,
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F7FF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#04295A',
  },
  searchResultAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#04295A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  searchResultAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  searchResultInfo: {
    flex: 1,
  },
  searchResultName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#04295A',
    marginBottom: 2,
  },
  searchResultId: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  searchResultKey: {
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  searchResultSelectBadge: {
    backgroundColor: '#04295A',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  searchResultSelectText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  searchHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  searchHintText: {
    flex: 1,
    color: '#8C98A6',
    fontSize: 13,
    fontWeight: '500',
  },
});
