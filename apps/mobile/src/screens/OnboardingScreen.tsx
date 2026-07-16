import React, { useState, useRef, useEffect } from 'react';
import { Image } from 'expo-image';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Dimensions,
  ScrollView,
  LayoutAnimation,
  UIManager,
  Animated,
  BackHandler,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppButton } from '../components/ui/AppButton';
import { AppPinInput } from '../components/ui/AppPinInput';
import {
  setOnboardingComplete,
  saveUserPin,
  saveUserPinSecure,
  saveUserPhone,
  saveUserFirstName,
  saveUserLastName,
  saveUserEmail,
  saveRegisteredPhone,
  saveMainWalletSecret,
} from '../services/storage/onboardingStorage';
import { checkUserExists, registerAccount } from '../services/api/accounts';
import { getOrGenerateDeviceKeypair } from '../services/wallet/deviceKeyStore';
import { synchronizeOfflineDeviceKey } from '../services/wallet/offlineKeySync';
import { synchronizeRecipientRegistry } from '../services/wallet/recipientRegistrySync';
import { getSep10Token, Keypair as StellarKeypair } from '../services/stellar/anchorService';
import { useAuth } from '../context/AuthContext';
import { StatusBar } from 'expo-status-bar';
import { generateWalletMnemonic, deriveKeysFromMnemonic } from '../services/wallet/mnemonic';
import * as SecureStore from 'expo-secure-store';
import { ensureMigration } from '../services/storage/migration';
import * as Clipboard from 'expo-clipboard';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const API_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://pijin-api.vercel.app';
const FRIENDBOT_RETRY_DELAY_MS = 2_000;


// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const ONBOARDING_DARK_BLUE = '#031634';
const ONBOARDING_LIGHT_GRAY = '#EDEDED';

type UserFlowType = 'new' | 'returning' | null;

type RootStackParamList = {
  Onboarding: { initialStep?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 } | undefined;
  SignIn: undefined;
  Dashboard: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

export function OnboardingScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'Onboarding'>>();
  const scrollViewRef = useRef<ScrollView>(null);
  
  const { login } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8>(1);
  const [maxAllowedStep, setMaxAllowedStep] = useState<number>(1);
  const [userFlowType, setUserFlowType] = useState<UserFlowType>(null);
  const [isCheckingUser, setIsCheckingUser] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  // Phone form
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState('');

  // OTP
  const [otp, setOtp] = useState('');

  // Name & Info (new users only)
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [firstNameError, setFirstNameError] = useState('');
  const [lastNameError, setLastNameError] = useState('');
  const [emailError, setEmailError] = useState('');

  // PIN
  const [pin, setPin] = useState('');

  // Mnemonic
  const [mnemonic, setMnemonic] = useState('');
  const [verifyWords, setVerifyWords] = useState<string[]>(['', '', '']);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Animated value tracking the active step (1 to 5) for dots animation
  const activeStepAnimated = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(activeStepAnimated, {
      toValue: step,
      useNativeDriver: false,
      friction: 8,
      tension: 50,
    }).start();
  }, [step]);

  // Handle navigating to initialStep if passed from navigation params
  useEffect(() => {
    if (route.params?.initialStep) {
      const targetStep = route.params.initialStep;
      // We need to wait for layout/ref to be ready if called on mount
      const timeout = setTimeout(() => {
        navigateToStep(targetStep);
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [route.params?.initialStep]);

  // Intercept native back button on Android
  useEffect(() => {
    const backAction = () => {
      if (step > 1) {
        if (step === 3) setUserFlowType(null);
        navigateToStep((step - 1) as any);
        return true;
      }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [step, userFlowType]);

  // Slides 1, 3, 6, 8 are dark; 2, 4, 5, 7 are light
  const isDark = step === 1 || step === 3 || step === 6 || step === 8;


  const navigateToStep = (targetStep: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) => {
    if (targetStep > maxAllowedStep) {
      setMaxAllowedStep(targetStep);
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStep(targetStep);
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        x: (targetStep - 1) * SCREEN_WIDTH,
        animated: true,
      });
    }, 50);
  };

  const handleCreateAccount = () => {
    navigateToStep(2);
  };

  const handleSignIn = () => {
    navigation.navigate('SignIn');
  };

  const handleSendOtp = async () => {
    if (isSendingOtp) return; // debounce
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanNumber.length !== 10) {
      setPhoneError('Please enter a valid 10-digit phone number (e.g. 9123456789)');
      return;
    }
    setPhoneError('');
    setIsSendingOtp(true);
    try {
      await saveUserPhone(cleanNumber);

      // Check if user already exists (determines flow type)
      const { exists } = await checkUserExists(cleanNumber).catch(() => ({ exists: false }));
      setUserFlowType(exists ? 'returning' : 'new');

      // Send the real OTP via the backend
      const e164 = `+63${cleanNumber}`;
      const response = await fetch(`${API_URL}/api/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: e164 }),
      });

      const responseText = await response.text();
      let json: any = {};
      try {
        json = responseText ? JSON.parse(responseText) : {};
      } catch (parseErr) {
        json = { error: responseText || `Request failed with status ${response.status}` };
      }

      if (!response.ok || !json.success) {
        throw new Error(json.error ?? 'Failed to send OTP. Please try again.');
      }

      navigateToStep(3);
    } catch (e: any) {
      console.error('handleSendOtp error:', e);
      Alert.alert('Error', e?.message ?? 'Failed to send OTP. Please try again.');
    } finally {
      setIsSendingOtp(false);
    }
  };


  const handleVerifyOtp = async (code: string) => {
    if (code.length !== 6) return;
    if (isVerifyingOtp) return;
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    const e164 = `+63${cleanNumber}`;
    setIsVerifyingOtp(true);
    try {
      const response = await fetch(`${API_URL}/api/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: e164, code }),
      });

      const responseText = await response.text();
      let json: any = {};
      try {
        json = responseText ? JSON.parse(responseText) : {};
      } catch (parseErr) {
        json = { error: responseText || `Request failed with status ${response.status}` };
      }

      if (!response.ok || !json.success) {
        throw new Error(json.error ?? 'Invalid OTP. Please try again.');
      }
      // OTP verified — proceed based on user flow
      if (userFlowType === 'returning') {
        navigation.replace('SignIn');
      } else {
        navigateToStep(4);
      }
    } catch (e: any) {
      console.error('handleVerifyOtp error:', e);
      setOtp(''); // clear the input
      Alert.alert('Verification Failed', e?.message ?? 'Invalid OTP. Please try again.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  /** Called by AppPinInput onChange; auto-verifies when all 6 digits entered. */
  const handleOtpChange = (value: string) => {
    setOtp(value);
    if (value.length === 6) {
      handleVerifyOtp(value);
    }
  };


  const handleNameContinue = async () => {
    let hasError = false;
    if (!firstName.trim()) { setFirstNameError('Please enter your first name'); hasError = true; }
    if (!lastName.trim()) { setLastNameError('Please enter your last name'); hasError = true; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) { setEmailError('Please enter a valid email address'); hasError = true; }
    if (hasError) return;
    try {
      await saveUserFirstName(firstName.trim());
      await saveUserLastName(lastName.trim());
      await saveUserEmail(email.trim());
      navigateToStep(5);
    } catch (e) {
      console.error('Failed to save user info:', e);
      Alert.alert('Error', 'Failed to save your information. Please try again.');
    }
  };

  const handlePinConfirm = async () => {
    if (pin.length !== 4) {
      Alert.alert('Invalid PIN', 'Please enter a 4-digit PIN.');
      return;
    }
    const newMnemonic = generateWalletMnemonic();
    setMnemonic(newMnemonic);
    navigateToStep(6);
  };

  const handleBackupContinue = () => {
    navigateToStep(7);
  };

  const handleCopyPhrase = async () => {
    await Clipboard.setStringAsync(mnemonic);
    Alert.alert('Copied', 'Seed phrase copied to clipboard!');
  };

  const handleVerifyConfirm = async () => {
    const words = mnemonic.split(' ');
    if (
      verifyWords[0].trim().toLowerCase() !== words[2] ||
      verifyWords[1].trim().toLowerCase() !== words[6] ||
      verifyWords[2].trim().toLowerCase() !== words[10]
    ) {
      Alert.alert('Verification Failed', 'One or more words are incorrect. Please check your backup.');
      return;
    }
    try {
      await saveUserPin(pin);
      await saveUserPinSecure(pin);
      navigateToStep(8);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to secure PIN. Please try again.');
    }
  };

  const fundMainWallet = async (publicKey: string, retries = 3): Promise<void> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${API_URL}/api/friendbot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKey }),
        });

        if (response.ok) {
          return;
        }

        const body = await response.text().catch(() => '');
        if (response.status < 500) {
          throw new Error(body || `Friendbot request failed with status ${response.status}`);
        }

        console.warn(`[Friendbot Proxy] HTTP ${response.status} on attempt ${attempt}: ${body}`);
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Friendbot Proxy] Attempt ${attempt} failed: ${message}`);
      }

      if (attempt < retries) {
        await new Promise<void>((resolve) => setTimeout(resolve, FRIENDBOT_RETRY_DELAY_MS));
      }
    }
  };

  const handleEnterPijin = async () => {
    setIsRegistering(true);
    
    // Yield to the UI thread so the button loading state renders immediately
    // before the heavy cryptographic key derivation blocks the main thread.
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const { mainWalletKeypair, deviceKeypair } = deriveKeysFromMnemonic(mnemonic);
      
      const offlineDeviceKey = deviceKeypair.publicKey();
      const stellarPublicKey = mainWalletKeypair.publicKey();
      
      const mainWalletSecret = mainWalletKeypair.secret();
      const deviceWalletSecret = deviceKeypair.secret();

      await saveMainWalletSecret(mainWalletSecret);
      await ensureMigration();
      await SecureStore.setItemAsync('pijn.device.secret', deviceWalletSecret);

      // TEMPORARY DEVELOPMENT RECOVERY PATCH. Never runs in release builds.
      if (__DEV__) {
        console.warn(
          `[DEV ONLY][WALLET RECOVERY] publicKey=${stellarPublicKey} secretKey=${mainWalletSecret}`,
        );
      }
      await fundMainWallet(stellarPublicKey);

      // Register the account on the backend with two DISTINCT keys.
      // The Stellar wallet key is the on-chain balance address; the device key
      // is only for offline signing.
      const registrationPayload = {
        stellarPublicKey,
        offlineDeviceKey,
        pin,
        phoneNumber: '63' + phoneNumber,
        firstName,
        lastName,
        email,
      };
      const account = await registerAccount(registrationPayload);

      // Get the SEP-10 authentication JWT token using the funded main wallet.
      const token = await getSep10Token(mainWalletKeypair);

      // The contract registry is the authoritative short ID -> payment address map.
      // This response also seeds the configuration required to sign while offline.
      await synchronizeRecipientRegistry(token);

      // Enroll the device key on-chain and mirror it to the database before
      // enabling offline voucher creation.
      await synchronizeOfflineDeviceKey(mainWalletKeypair, token);

      // Save onboarding complete and phone
      await saveRegisteredPhone(phoneNumber);
      await setOnboardingComplete(true);

      // Perform local session login
      await login(stellarPublicKey, account.shortId, token);

      navigation.reset({
        index: 0,
        routes: [{ name: 'Dashboard' }],
      });
    } catch (e) {
      console.error('[Onboarding Register Error]', e);
      const errorMessage = e instanceof Error ? e.message : 'Please check your connection and try again.';
      Alert.alert('Registration Failed', errorMessage);
    } finally {
      setIsRegistering(false);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      if (step === 3) setUserFlowType(null);
      navigateToStep((step - 1) as any);
    }
  };

  const renderBackArrow = () => {
    // Hide back button on success slide
    if (step === 1 || step === 8) return <View style={styles.backButtonPlaceholder} />;
    return (
      <TouchableOpacity onPress={handleBack} style={styles.backButton} activeOpacity={0.7}>
        <Ionicons
          name="arrow-undo-outline"
          size={28}
          color={isDark ? '#FFFFFF' : '#08090A'}
        />
      </TouchableOpacity>
    );
  };

  const renderDots = () => {
    // No dots on welcome screen or phone entry (flow type not yet determined)
    if (step <= 2) return null;
    const dotSteps = userFlowType === 'returning' ? [2, 3] : [2, 3, 4, 5, 6, 7, 8];
    const dotColor = isDark ? '#FFFFFF' : '#031634';
    return (
      <View style={styles.dotsContainer}>
        {dotSteps.map((i) => {
          const dotWidth = activeStepAnimated.interpolate({
            inputRange: [i - 1, i, i + 1],
            outputRange: [8, 24, 8],
            extrapolate: 'clamp',
          });
          const dotOpacity = activeStepAnimated.interpolate({
            inputRange: [i - 1, i, i + 1],
            outputRange: [0.35, 1, 0.35],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={i}
              style={[styles.dot, { width: dotWidth, opacity: dotOpacity, backgroundColor: dotColor }]}
            />
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: isDark ? ONBOARDING_DARK_BLUE : ONBOARDING_LIGHT_GRAY }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          {renderBackArrow()}
        </View>

        {/* Sliding Scroll Container */}
        <ScrollView
          ref={scrollViewRef}
          horizontal
          pagingEnabled
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          bounces={false}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollViewContent}
        >
          {/* Slide 1: Welcome Screen */}
          <View style={styles.slide}>
            {/* Map background behind the bird */}
            <Image
              source={require('../../assets/onboarding/onboarding-map.png')}
              style={styles.mapBackground}
              contentFit="contain"
            />
            
            <View style={styles.welcomeTextContainer}>
              <Text style={styles.welcomeTitle}>Welcome to</Text>
              <Text style={styles.welcomeAppName}>Pijin!</Text>
              <Text style={styles.welcomeSubtitle}>
                Bridging digital money within reach, even offline.
              </Text>
            </View>

            {/* Set pointerEvents="none" so clicks pass through the pigeon's feet to the buttons */}
            <View style={styles.welcomePigeonContainer} pointerEvents="none">
              <Image
                source={require('../../assets/onboarding/onboarding-1.png')}
                style={styles.welcomePigeonImage}
                contentFit="contain"
              />
            </View>

            <View style={styles.welcomeButtonsContainer}>
              <AppButton
                title="Continue"
                onPress={handleCreateAccount}
                variant="secondary"
                icon={<Ionicons name="arrow-forward" size={24} color="#08090A" />}
              />
            </View>
          </View>

          {/* Slide 2: Enter Phone Number */}
          <View style={styles.slide}>
            <ScrollView 
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false} 
              contentContainerStyle={styles.innerScrollContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {/* Shrink illustration height when focused for smooth keyboard avoidance */}
              <View style={styles.illustrationContainer}>
                <Image
                  source={require('../../assets/onboarding/onboarding-2.png')}
                  style={styles.illustrationImage}
                  contentFit="contain"
                />
              </View>

              {/* Core form elements grouped tightly to remove dead space */}
              <View style={styles.formContentContainer}>
              <View style={styles.textContainerLeft}>
                <Text style={styles.stepTitleLight}>Enter your phone number</Text>
                <Text style={styles.stepSubtitleLight}>
                  Link your mobile number to set up your online and offline accounts
                </Text>
              </View>

              <View style={styles.inputContainerRow}>
                <View style={styles.countryCodeContainer}>
                  <Text style={styles.countryCodeText}>+63</Text>
                  <Ionicons name="caret-down" size={12} color="#08090A" style={styles.caret} />
                </View>
                <View style={styles.phoneInputWrapper}>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="912 345 6789"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="phone-pad"
                    value={phoneNumber}
                    onChangeText={(text) => {
                      setPhoneNumber(text.replace(/[^0-9]/g, ''));
                      setPhoneError('');
                    }}
                    maxLength={10}
                  />
                </View>
              </View>
              {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
            </View>

            <View style={styles.footer}>
              {(isCheckingUser || isSendingOtp) ? (
                <View style={styles.loadingButtonDark}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={[styles.loadingButtonText, { color: '#FFFFFF' }]}>Sending OTP...</Text>
                </View>
              ) : (
                <AppButton
                  title="Send OTP"
                  onPress={handleSendOtp}
                  variant="primary"
                  icon={<Ionicons name="paper-plane-outline" size={24} color="#FFFFFF" />}
                />
              )}
            </View>
            </ScrollView>
          </View>

          {/* Slide 3: Verify OTP */}
          <View style={styles.slide}>
            <ScrollView 
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false} 
              contentContainerStyle={styles.innerScrollContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
            {/* Core form elements grouped tightly to remove dead space */}
            <View style={styles.formContentContainer}>
              <View style={styles.textContainerLeft}>
                <Text style={styles.stepTitleDark}>Verify OTP</Text>
                <Text style={styles.stepSubtitleDark}>
                  We sent a 6-digit code to +63 {phoneNumber ? `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6)}` : '991-598-4988'}
                </Text>
              </View>

              <AppPinInput
                value={otp}
                onChange={handleOtpChange}
                theme="dark"
                length={6}
                inputSize={46}
              />

              <TouchableOpacity
                style={styles.resendContainer}
                activeOpacity={0.7}
                onPress={handleSendOtp}
                disabled={isSendingOtp}
              >
                <Text style={styles.resendTextMuted}>Didn't get an OTP? </Text>
                {isSendingOtp ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.resendTextLink}>Resend</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Shrink illustration height when focused for smooth keyboard avoidance */}
            <View style={styles.otpIllustrationContainer}>
              <Image
                source={require('../../assets/onboarding/onboarding-3.png')}
                style={styles.otpIllustrationImage}
                contentFit="contain"
              />
            </View>

            <View style={styles.footer}>
              {isVerifyingOtp ? (
                <View style={styles.loadingButton}>
                  <ActivityIndicator color="#08090A" size="small" />
                  <Text style={[styles.loadingButtonText, { color: '#08090A' }]}>Verifying...</Text>
                </View>
              ) : (
                <AppButton
                  title="Verify OTP"
                  onPress={() => handleVerifyOtp(otp)}
                  variant="secondary"
                  icon={<Ionicons name="shield-checkmark-outline" size={24} color="#08090A" />}
                />
              )}
            </View>
            </ScrollView>
          </View>

          {/* Slide 4: Name & Info (new users only) */}
          <View style={styles.slide}>
            <ScrollView 
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false} 
              contentContainerStyle={styles.innerScrollContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
            <View style={styles.illustrationContainer}>
              <Image
                source={require('../../assets/onboarding/onboarding-2.png')}
                style={styles.illustrationImage}
                contentFit="contain"
              />
            </View>

            <View style={styles.formContentContainer}>
              <View style={styles.textContainerLeft}>
                <Text style={styles.stepTitleLight}>Tell us about you</Text>
                <Text style={styles.stepSubtitleLight}>
                  Enter your details to complete registration
                </Text>
              </View>

              <View style={styles.infoInputGroup}>
                <View style={styles.nameRow}>
                  <View style={styles.nameInputWrapper}>
                    <TextInput
                      style={styles.infoInput}
                      placeholder="First Name"
                      placeholderTextColor="#9CA3AF"
                      value={firstName}
                      onChangeText={(t) => { setFirstName(t); setFirstNameError(''); }}
                    />
                  </View>
                  <View style={styles.nameInputWrapper}>
                    <TextInput
                      style={styles.infoInput}
                      placeholder="Last Name"
                      placeholderTextColor="#9CA3AF"
                      value={lastName}
                      onChangeText={(t) => { setLastName(t); setLastNameError(''); }}
                    />
                  </View>
                </View>
                {(firstNameError || lastNameError) ? (
                  <Text style={styles.errorText}>{firstNameError || lastNameError}</Text>
                ) : null}

                <View style={styles.emailInputWrapper}>
                  <TextInput
                    style={styles.infoInput}
                    placeholder="Email Address"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={(t) => { setEmail(t); setEmailError(''); }}
                  />
                </View>
                {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
              </View>
            </View>

            <View style={styles.footer}>
              <AppButton
                title="Continue"
                onPress={handleNameContinue}
                variant="primary"
                icon={<Ionicons name="arrow-forward" size={24} color="#FFFFFF" />}
              />
            </View>
            </ScrollView>
          </View>

          {/* Slide 5: Secure PIN */}
          <View style={styles.slide}>
            <ScrollView 
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false} 
              contentContainerStyle={styles.innerScrollContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {/* Shrink illustration height when focused for smooth keyboard avoidance */}
              <View style={styles.illustrationContainer}>
                <Image
                  source={require('../../assets/onboarding/onboarding-4.png')}
                  style={styles.illustrationImage}
                  contentFit="contain"
                />
              </View>

              {/* Core form elements grouped tightly to remove dead space */}
              <View style={styles.formContentContainer}>
              <View style={styles.textContainerLeft}>
                <Text style={styles.stepTitleLight}>Secure Your Account</Text>
                <Text style={styles.stepSubtitleLight}>
                  Create a 4-digit PIN to protect your device
                </Text>
              </View>

              <AppPinInput
                value={pin}
                onChange={setPin}
                theme="light"
                length={4}
                secureTextEntry={true}
              />
            </View>

            <View style={styles.footer}>
              <AppButton
                title="Continue"
                onPress={handlePinConfirm}
                variant="primary"
                icon={<Ionicons name="arrow-forward" size={24} color="#FFFFFF" />}
              />
            </View>
            </ScrollView>
          </View>

          {/* Slide 6: Backup Wallet */}
          <View style={styles.slide}>
            <ScrollView 
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false} 
              contentContainerStyle={styles.innerScrollContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              <View style={styles.formContentContainer}>
                <View style={styles.textContainerLeft}>
                  <Text style={styles.stepTitleDark}>Backup Wallet</Text>
                  <Text style={styles.stepSubtitleDark}>
                    Write down these 12 words in order. This is the ONLY way to recover your account if you lose your phone.
                  </Text>
                </View>

                <View style={styles.mnemonicGrid}>
                  {mnemonic.split(' ').map((word, index) => (
                    <View key={index} style={styles.mnemonicWordContainer}>
                      <Text style={styles.mnemonicWordIndex}>{index + 1}.</Text>
                      <Text style={styles.mnemonicWord}>{word}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity style={styles.copyButton} onPress={handleCopyPhrase} activeOpacity={0.7}>
                  <Ionicons name="copy-outline" size={20} color="#9CA3AF" />
                  <Text style={styles.copyButtonText}>Copy to clipboard</Text>
                </TouchableOpacity>

                <View style={styles.tipContainer}>
                  <Ionicons name="warning-outline" size={16} color="#B45309" />
                  <Text style={styles.tipText}>
                    Do not share this phrase with anyone or take a screenshot. Keep it safe!
                  </Text>
                </View>
              </View>

              <View style={styles.footer}>
                <AppButton
                  title="I've written it down"
                  onPress={handleBackupContinue}
                  variant="secondary"
                  icon={<Ionicons name="checkmark-done" size={24} color="#08090A" />}
                />
              </View>
            </ScrollView>
          </View>

          {/* Slide 7: Verify Wallet */}
          <View style={styles.slide}>
            <ScrollView 
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false} 
              contentContainerStyle={styles.innerScrollContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              <View style={styles.formContentContainer}>
                <View style={styles.textContainerLeft}>
                  <Text style={styles.stepTitleLight}>Verify Backup</Text>
                  <Text style={styles.stepSubtitleLight}>
                    Let's make sure you wrote it down correctly. Enter words 3, 7, and 11.
                  </Text>
                </View>

                <View style={styles.infoInputGroup}>
                  <View style={styles.emailInputWrapper}>
                    <TextInput
                      style={styles.infoInput}
                      placeholder="Word #3"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={verifyWords[0]}
                      onChangeText={(t) => {
                        const newWords = [...verifyWords];
                        newWords[0] = t;
                        setVerifyWords(newWords);
                      }}
                    />
                  </View>
                  <View style={styles.emailInputWrapper}>
                    <TextInput
                      style={styles.infoInput}
                      placeholder="Word #7"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={verifyWords[1]}
                      onChangeText={(t) => {
                        const newWords = [...verifyWords];
                        newWords[1] = t;
                        setVerifyWords(newWords);
                      }}
                    />
                  </View>
                  <View style={styles.emailInputWrapper}>
                    <TextInput
                      style={styles.infoInput}
                      placeholder="Word #11"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={verifyWords[2]}
                      onChangeText={(t) => {
                        const newWords = [...verifyWords];
                        newWords[2] = t;
                        setVerifyWords(newWords);
                      }}
                    />
                  </View>
                </View>

                <View style={styles.verifyIllustrationContainer}>
                  <Image
                    source={require('../../assets/seed phrase/piji-verify.png')}
                    style={styles.verifyIllustrationImage}
                    contentFit="contain"
                  />
                </View>
              </View>

              <View style={styles.footer}>
                <AppButton
                  title="Verify & Secure Vault"
                  onPress={handleVerifyConfirm}
                  variant="primary"
                  icon={<Ionicons name="shield-checkmark" size={24} color="#FFFFFF" />}
                />
              </View>
            </ScrollView>
          </View>

          {/* Slide 8: Success Screen */}
          <View style={styles.slide}>
            <View style={styles.textContainerLeft}>
              <Text style={styles.stepTitleDark}>Vault Secured</Text>
              <Text style={styles.stepSubtitleDark}>
                Your device is now armed for offline, zero data transactions.
              </Text>
            </View>

            <View style={styles.successIllustrationContainer}>
              <Image
                source={require('../../assets/onboarding/onboarding-5.png')}
                style={styles.successIllustrationImage}
                contentFit="contain"
              />
            </View>

            <View style={styles.footer}>
              <AppButton
                title={isRegistering ? "Registering account..." : "Enter Pijin"}
                onPress={handleEnterPijin}
                variant="secondary"
                icon={<Ionicons name="log-in-outline" size={24} color="#08090A" />}
                loading={isRegistering}
              />
            </View>
          </View>
        </ScrollView>

        {/* Static Dots Indicator at the bottom */}
        {renderDots()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 56,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  backButtonPlaceholder: {
    width: 44,
    height: 44,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    flexGrow: 1,
  },
  innerScrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingBottom: 24,
  },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  mapBackground: {
    position: 'absolute',
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.70,
    top: SCREEN_HEIGHT * 0.1,
    left: 0,
    opacity: 1,
  },
  welcomeTextContainer: {
    marginTop: SCREEN_HEIGHT * 0.02,
    alignItems: 'center',
  },
  welcomeTitle: {
    fontSize: 48,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 44,
  },
  welcomeAppName: {
    fontSize: 48,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 48,
    marginBottom: 8,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingHorizontal: 24,
    lineHeight: 20,
  },
  welcomePigeonContainer: {
    position: 'absolute',
    bottom: 120, // Increased to push the mascot up so it stands on the button edge
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT * 0.5, // Relative to screen height so it scales proportionally
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 5,
  },
  welcomePigeonImage: {
    width: '100%', // Reverted to original 85%
    height: '100%',
  },
  welcomeButtonsContainer: {
    width: '100%',
    paddingBottom: 48,
    zIndex: 2,
  },
  formContentContainer: {
    width: '100%',
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 24,
  },
  formContentContainerCollapsed: {
    paddingTop: 12,
  },
  illustrationContainer: {
    height: SCREEN_HEIGHT * 0.35,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  illustrationContainerCollapsed: {
    display: 'none',
  },
  illustrationImage: {
    width: '110%', // Reverted to original 85%
    height: '100%',
  },
  verifyIllustrationContainer: {
    height: SCREEN_HEIGHT * 0.25,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  verifyIllustrationImage: {
    width: '80%',
    height: '100%',
  },
  otpIllustrationContainer: {
    height: SCREEN_HEIGHT * 0.35,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 12,
  },
  otpIllustrationContainerCollapsed: {
    display: 'none',
  },
  otpIllustrationImage: {
    width: '75%', // Reverted to original 75%
    height: '100%',
  },
  successIllustrationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 12,
  },
  successIllustrationImage: {
    width: '115%', // Reverted to original 85%
    height: '100%',
    marginTop: 120,
  },
  textContainerLeft: {
    alignItems: 'flex-start',
    marginTop: 12,
    marginBottom: 8,
  },
  keyboardActiveTextContainer: {
    marginTop: 20,
    marginBottom: 20,
  },
  stepTitleLight: {
    fontSize: 36,
    fontWeight: '800',
    color: '#08090A',
    marginBottom: 8,
  },
  stepSubtitleLight: {
    fontSize: 16,
    color: '#4B5563',
    lineHeight: 20,
  },
  stepTitleDark: {
    fontSize: 36,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  stepSubtitleDark: {
    fontSize: 16,
    color: '#9CA3AF',
    lineHeight: 20,
  },
  inputContainerRow: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 12,
  },
  countryCodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#031634',
    borderRadius: 8,
    paddingHorizontal: 16,
    height: 52,
    gap: 4,
  },
  countryCodeText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#08090A',
  },
  caret: {
    marginTop: 2,
  },
  phoneInputWrapper: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#031634',
    borderRadius: 8,
    height: 52,
  },
  phoneInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#08090A',
    paddingHorizontal: 16,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginTop: -4,
    marginBottom: 8,
  },
  resendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: 8,
  },
  resendTextMuted: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  resendTextLink: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  footer: {
    width: '100%',
    paddingBottom: 48,
  },
  footerCollapsed: {
    paddingBottom: 16,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 16,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  infoInputGroup: {
    gap: 12,
    marginTop: 12,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameInputWrapper: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#031634',
    borderRadius: 8,
    height: 52,
    justifyContent: 'center',
  },
  emailInputWrapper: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#031634',
    borderRadius: 8,
    height: 52,
    justifyContent: 'center',
  },
  infoInput: {
    fontSize: 16,
    fontWeight: '600',
    color: '#08090A',
    paddingHorizontal: 16,
  },
  loadingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EDEDED',
    borderRadius: 12,
    height: 56,
    gap: 10,
  },
  loadingButtonDark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#031634',
    borderRadius: 12,
    height: 56,
    gap: 10,
  },
  loadingButtonText: {
    color: '#08090A',
    fontSize: 16,
    fontWeight: '700',
  },
  mnemonicGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 24,
    justifyContent: 'space-between',
  },
  mnemonicWordContainer: {
    width: '30%',
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mnemonicWordIndex: {
    color: '#9CA3AF',
    fontSize: 12,
    marginRight: 6,
    width: 16,
  },
  mnemonicWord: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 8,
    marginTop: 24,
    gap: 8,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: '#B45309',
    fontWeight: '500',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 12,
    gap: 8,
  },
  copyButtonText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '600',
  },
});

