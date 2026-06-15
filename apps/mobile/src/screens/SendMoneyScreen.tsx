import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { useVaultBalance } from '../hooks/useVaultBalance';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CACHED_BALANCE_KEY = 'abotpera.cached_balance';

const MOCK_CONTACTS = [
  { name: 'Donna Paulsen', shortId: 'M-1B44', initials: 'DP' },
  { name: 'Harvey Specter', shortId: 'M-HRV1', initials: 'HS' },
  { name: 'Mike Ross', shortId: 'M-MIK1', initials: 'MR' },
  { name: 'Rachel Zane', shortId: 'M-RCH1', initials: 'RZ' },
  { name: 'Louis Litt', shortId: 'M-LOU1', initials: 'LL' },
];

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

  // Error states
  const [recipientShortIdError, setRecipientShortIdError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);

  // Modal state
  const [contactsModalVisible, setContactsModalVisible] = useState(false);

  // Fetch cached balance and network status on mount
  useEffect(() => {
    const getCached = async () => {
      try {
        const onlineStr = await AsyncStorage.getItem('abotpera.is_online');
        const online = onlineStr !== 'false';
        setIsOnline(online);

        const key = online ? CACHED_BALANCE_KEY : 'abotpera.offline_balance';
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
  }, []);

  // Prefill scanned QR data
  useEffect(() => {
    const rxShortId = route?.params?.recipientShortId;
    if (rxShortId) {
      setRecipientShortId(rxShortId);
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

  const handleContinue = () => {
    let hasError = false;

    // Validate recipient short ID
    if (!recipientShortId.trim()) {
      setRecipientShortIdError('Recipient Short ID is required');
      hasError = true;
    } else {
      setRecipientShortIdError(null);
    }

    // Validate amount
    const numAmount = parseFloat(amount);
    if (!amount.trim() || isNaN(numAmount) || numAmount <= 0) {
      setAmountError('Please enter a valid amount');
      hasError = true;
    } else if (numAmount + 0.50 > currentBalance) {
      setAmountError('Insufficient balance (including ₱0.50 fee)');
      hasError = true;
    } else {
      setAmountError(null);
    }

    if (hasError) return;

    // Navigate to confirmation page
    navigation.navigate('SendMoneyConfirm', {
      recipientShortId: recipientShortId.trim(),
      amount: numAmount,
      note: note.trim(),
    });
  };

  const handleContactSelect = (selectedShortId: string) => {
    setRecipientShortId(selectedShortId);
    setRecipientShortIdError(null);
    setContactsModalVisible(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
          <Text style={styles.headerTitle}>Send money</Text>
        </View>

        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Short ID Input */}
          <View style={styles.fieldWrapper}>
            <View style={styles.inputContainer}>
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>Short ID</Text>
              </View>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="ex. M-1B44"
                  placeholderTextColor="#8C98A6"
                  value={recipientShortId}
                  onChangeText={(text) => {
                    setRecipientShortId(text);
                    if (recipientShortIdError) setRecipientShortIdError(null);
                  }}
                  autoCapitalize="characters"
                />
                <TouchableOpacity 
                  onPress={() => setContactsModalVisible(true)} 
                  style={styles.iconButton}
                  activeOpacity={0.7}
                >
                  <Ionicons name="book-outline" size={22} color="#04295A" />
                </TouchableOpacity>
              </View>
            </View>
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
                    // Clean text to numeric only
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
          >
            <Text style={styles.continueButtonText}>Continue  →</Text>
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

        {/* Contacts Modal */}
        <Modal
          visible={contactsModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setContactsModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select Recipient</Text>
                <TouchableOpacity 
                  onPress={() => setContactsModalVisible(false)}
                  style={styles.closeButton}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close" size={24} color="#04295A" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.contactsList} showsVerticalScrollIndicator={false}>
                {MOCK_CONTACTS.map((contact, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.contactItem}
                    onPress={() => handleContactSelect(contact.shortId)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{contact.initials}</Text>
                    </View>
                    <View style={styles.contactInfo}>
                      <Text style={styles.contactName}>{contact.name}</Text>
                      <Text style={styles.contactPhone}>ID: {contact.shortId}</Text>
                    </View>
                    <Ionicons name="chevron-forward-outline" size={20} color="#D1D5DB" />
                  </TouchableOpacity>
                ))}
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
    fontSize: 16,
    fontWeight: '700',
    color: '#04295A',
    paddingVertical: 8,
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
    left: 4, // Visual balance for letter-spacing offset
  },
  getHelpLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#04295A',
    textDecorationLine: 'underline',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '60%',
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
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
  contactsList: {
    marginBottom: 10,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF1F5',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E5EDF6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#04295A',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#04295A',
    marginBottom: 2,
  },
  contactPhone: {
    fontSize: 13,
    color: '#707984',
    fontWeight: '500',
  },
});

