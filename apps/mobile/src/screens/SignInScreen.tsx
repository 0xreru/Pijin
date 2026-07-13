import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  Animated,
  Dimensions,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import {
  getMainWalletSecret,
  getUserPin,
  getUserPinSecure,
  getUserPhone,
  saveUserPin,
  saveUserPinSecure,
} from '../services/storage/onboardingStorage';
import { checkUserExists } from '../services/api/accounts';
import { getSep10Token, Keypair as StellarKeypair } from '../services/stellar/anchorService';
import { useAuth } from '../context/AuthContext';
import { loadStoredAccount } from '../services/storage/accountStorage';
import { synchronizeOfflineDeviceKey } from '../services/wallet/offlineKeySync';
import { synchronizeRecipientRegistry } from '../services/wallet/recipientRegistrySync';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const KEYPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'backspace'],
];

export function SignInScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();

  const [pin, setPin] = useState('');
  // Start with empty string — loadUserData() will populate from AsyncStorage.
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isValidating, setIsValidating] = useState(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loadUserData = async () => {
      try {
        const storedPhone = await getUserPhone();
        if (storedPhone) {
          setPhoneNumber(storedPhone);
        }
      } catch (e) {
        console.error('Failed to load stored user phone:', e);
      }
    };
    loadUserData();
  }, []);

  const triggerShake = () => {
    setPin('');
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const validatePin = async (enteredPin: string) => {
    setIsValidating(true);
    try {
      // ── Tier 1: AsyncStorage (fastest, cleared when app data is wiped)
      let pinToCompare = await getUserPin();

      // ── Tier 2: SecureStore (survives app data clears, same device)
      if (!pinToCompare) {
        pinToCompare = await getUserPinSecure();
      }

      // ── Tier 3: Backend DB (ultimate fallback — requires network)
      // Read phone directly from storage in case the state hasn't populated yet.
      if (!pinToCompare) {
        const phoneForQuery = phoneNumber || (await getUserPhone());
        if (phoneForQuery) {
          try {
            const checkRes = await checkUserExists(phoneForQuery);
            if (checkRes.exists && checkRes.pin) {
              pinToCompare = checkRes.pin;
              // Restore both local stores so future logins are offline-capable.
              await saveUserPin(pinToCompare);
              await saveUserPinSecure(pinToCompare);
            }
          } catch (networkErr) {
            console.warn('[SignIn] Could not fetch PIN from backend:', networkErr);
          }
        }
      }

      if (!pinToCompare) {
        // All three tiers exhausted — cannot verify without a known PIN.
        triggerShake();
        Alert.alert(
          'Cannot Verify PIN',
          'Your PIN could not be retrieved. Please ensure you are connected to the internet, then try again.',
        );
        setIsValidating(false);
        return;
      }

      if (enteredPin !== pinToCompare) {
        triggerShake();
        setIsValidating(false);
        return;
      }

      // PIN is correct. Load the persisted main wallet for SEP-10 auth.
      const mainWalletSecret = await getMainWalletSecret();
      const mainWalletKeypair = mainWalletSecret ? StellarKeypair.fromSecret(mainWalletSecret) : null;
      const mainWalletPublicKey = mainWalletKeypair?.publicKey();

      try {
        // Online check & authentication
        const checkRes = await checkUserExists(phoneNumber);

        if (checkRes.exists && checkRes.stellarPublicKey && checkRes.shortId) {
          if (!mainWalletKeypair || mainWalletPublicKey !== checkRes.stellarPublicKey) {
            Alert.alert(
              'Main Wallet Missing',
              'This device does not have the saved main wallet for this account. Please restore or re-onboard the account on this device.',
            );
            setIsValidating(false);
            return;
          }
          const token = await getSep10Token(mainWalletKeypair);
          await synchronizeRecipientRegistry(token);
          await synchronizeOfflineDeviceKey(mainWalletKeypair, token);
          await login(checkRes.stellarPublicKey, checkRes.shortId, token);
        } else {
          // Phone number not found in DB
          Alert.alert(
            'Account Not Found',
            'This phone number is not registered on the network. Please register first.',
            [{ text: 'OK', onPress: () => handleSwitchAccount() }]
          );
          setIsValidating(false);
          return;
        }
      } catch (networkError) {
        console.warn('[SignIn] Network error during online auth, attempting offline fallback:', networkError);

        // Offline fallback: load cached account from local storage
        const stored = await loadStoredAccount();
        if (stored && mainWalletPublicKey && stored.stellarPublicKey === mainWalletPublicKey) {
          // Proceed offline with empty/old token
          await login(stored.stellarPublicKey, stored.shortId, '');
        } else {
          // No cached account or mismatched key
          Alert.alert(
            'Connection Required',
            'First-time sign-in on this device requires an internet connection. Please connect to the internet and try again.'
          );
          setIsValidating(false);
          return;
        }
      }

      navigation.reset({
        index: 0,
        routes: [{ name: 'Dashboard' }],
      });
    } catch (e) {
      console.error('PIN verification failed:', e);
      triggerShake();
    } finally {
      setIsValidating(false);
    }
  };

  const handleKeyPress = (key: string) => {
    if (isValidating || pin.length >= 4) return;
    const newPin = pin + key;
    setPin(newPin);
    if (newPin.length === 4) {
      setTimeout(() => {
        validatePin(newPin);
      }, 150);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleSwitchAccount = () => {
    navigation.navigate('Onboarding', { initialStep: 2 });
  };

  const formatPhoneNumber = (phone: string) => {
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length !== 10) return `+63 - ${clean}`;
    return `+63 - ${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6)}`;
  };

  const renderPinDots = () => {
    return (
      <Animated.View style={[styles.dotsContainer, { transform: [{ translateX: shakeAnim }] }]}>
        {[0, 1, 2, 3].map((index) => {
          const isFilled = pin.length > index;
          return (
            <View
              key={index}
              style={[
                styles.pinDot,
                isFilled ? styles.pinDotFilled : styles.pinDotEmpty,
              ]}
            />
          );
        })}
      </Animated.View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
      <StatusBar style="light" />
      
      <Text style={styles.logo}>pijin</Text>

      <View style={styles.topContainer}>
        {/* Pigeon Illustration and Dynamic Badge Container */}
        <View style={styles.illustrationWrapper}>
          <Image
            source={require('../../assets/onboarding/sign-in.png')}
            style={styles.illustrationImage}
            resizeMode="contain"
          />
          {/* Cover/Overlay for the hardcoded number inside the badge */}
          <View style={styles.badgeOverlay}>
            <Text style={styles.badgeText}>{formatPhoneNumber(phoneNumber)}</Text>
          </View>
        </View>

        {/* Enter PIN text and dots */}
        <View style={styles.mpinSection}>
          {isValidating ? (
            <View style={{ height: 60, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text style={{ marginTop: 8, fontSize: 14, color: '#9CA3AF', fontWeight: '700' }}>Authenticating secure session...</Text>
            </View>
          ) : (
            <>
              <Text style={styles.enterMpinText}>Enter your MPIN</Text>
              {renderPinDots()}
            </>
          )}
        </View>

        {/* Tip Text */}
        <View style={styles.tipContainer}>
          <Ionicons name="information-circle-outline" size={14} color="#9CA3AF" />
          <Text style={styles.tipText}>Never share your MPIN or OTP with anyone.</Text>
        </View>
      </View>

      {/* Numerical Keypad at bottom */}
      <View style={[styles.keyboardContainer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.keypadGrid}>
          {KEYPAD.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.keyboardRow}>
              {row.map((key, colIndex) => {
                if (key === '') {
                  return <View key={colIndex} style={styles.keyButtonPlaceholder} />;
                }
                if (key === 'backspace') {
                  return (
                    <TouchableOpacity
                      key={colIndex}
                      style={styles.keyButton}
                      onPress={handleBackspace}
                      activeOpacity={0.6}
                    >
                      <Ionicons name="backspace-outline" size={28} color="#031634" />
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity
                    key={colIndex}
                    style={styles.keyButton}
                    onPress={() => handleKeyPress(key)}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.keyText}>{key}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        {/* Switch Account */}
        <TouchableOpacity style={styles.switchAccountButton} onPress={handleSwitchAccount} activeOpacity={0.7}>
          <Text style={styles.switchAccountTextNormal}>Not you? </Text>
          <Text style={styles.switchAccountTextBlue}>Switch account</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#031634',
    justifyContent: 'space-between',
  },
  logo: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 12,
    letterSpacing: 12,
  },
  topContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  illustrationWrapper: {
    width: SCREEN_WIDTH * 0.85,
    height: SCREEN_HEIGHT * 0.28,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 20,
  },
  illustrationImage: {
    width: '100%',
    height: '100%',
  },
  badgeOverlay: {
    position: 'absolute',
    bottom: -4,
    backgroundColor: '#0d2c54', // exact badge background color match
    borderRadius: 24,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  mpinSection: {
    alignItems: 'center',
    marginTop: 20,
    width: '100%',
  },
  enterMpinText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginVertical: 12,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  pinDotEmpty: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  pinDotFilled: {
    backgroundColor: '#FFFFFF',
  },
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    opacity: 0.8,
  },
  tipText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  keyboardContainer: {
    backgroundColor: '#EDEDED',
    paddingTop: 24,
    borderTopWidth: 1,
    borderColor: '#E5E7EB',
  },
  keypadGrid: {
    width: '100%',
    paddingHorizontal: 48,
    gap: 8,
  },
  keyboardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  keyButton: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyButtonPlaceholder: {
    width: 64,
    height: 64,
  },
  keyText: {
    fontSize: 32,
    fontWeight: '400',
    color: '#031634',
  },
  switchAccountButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
  switchAccountTextNormal: {
    fontSize: 14,
    color: '#4B5563',
  },
  switchAccountTextBlue: {
    fontSize: 14,
    color: '#635BFF',
    fontWeight: '700',
  },
});
