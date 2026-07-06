import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
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
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppButton } from '../components/ui/AppButton';
import { AppPinInput } from '../components/ui/AppPinInput';
import {
  setOnboardingComplete,
  saveUserPin,
  saveUserPhone,
  saveUserFirstName,
  saveUserLastName,
  saveUserEmail,
  saveRegisteredPhone,
} from '../services/storage/onboardingStorage';
import { checkUserExists, registerAccount } from '../services/api/accounts';
import { getOrGenerateDeviceKeypair } from '../services/wallet/deviceKeyStore';
import { getSep10Token } from '../services/stellar/anchorService';
import { useAuth } from '../context/AuthContext';
import { StatusBar } from 'expo-status-bar';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const ONBOARDING_DARK_BLUE = '#031634';
const ONBOARDING_LIGHT_GRAY = '#EDEDED';

type UserFlowType = 'new' | 'returning' | null;

type RootStackParamList = {
  Onboarding: { initialStep?: 1 | 2 | 3 | 4 | 5 | 6 } | undefined;
  SignIn: undefined;
  Dashboard: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

export function OnboardingScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'Onboarding'>>();
  const scrollViewRef = useRef<ScrollView>(null);
  
  const { login } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [maxAllowedStep, setMaxAllowedStep] = useState<number>(1);
  const [userFlowType, setUserFlowType] = useState<UserFlowType>(null);
  const [isCheckingUser, setIsCheckingUser] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);


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

  // Slides 1, 3, 6 are dark; 2, 4, 5 are light
  const isDark = step === 1 || step === 3 || step === 6;


  const navigateToStep = (targetStep: 1 | 2 | 3 | 4 | 5 | 6) => {
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
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanNumber.length !== 10) {
      setPhoneError('Please enter a valid 10-digit phone number (e.g. 9123456789)');
      return;
    }
    setPhoneError('');
    setIsCheckingUser(true);
    try {
      await saveUserPhone(cleanNumber);
      const { exists } = await checkUserExists(cleanNumber);
      setUserFlowType(exists ? 'returning' : 'new');
      navigateToStep(3);
    } catch (e) {
      console.error('Failed to check user:', e);
      setUserFlowType('new');
      navigateToStep(3);
    } finally {
      setIsCheckingUser(false);
    }
  };

  const handleOtpContinue = () => {
    if (otp.length !== 4) {
      Alert.alert('Invalid OTP', 'Please enter a 4-digit OTP.');
      return;
    }
    if (userFlowType === 'returning') {
      navigation.replace('SignIn');
    } else {
      navigateToStep(4);
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
    try {
      await saveUserPin(pin);
      navigateToStep(6);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to secure PIN. Please try again.');
    }
  };

  const handleEnterPijin = async () => {
    setIsRegistering(true);
    try {
      const keypair = await getOrGenerateDeviceKeypair();
      const publicKey = keypair.publicKey();

      // Register the account on the backend
      const account = await registerAccount({
        stellarPublicKey: publicKey,
        offlineDeviceKey: publicKey,
        pin,
        phoneNumber: '63' + phoneNumber,
        firstName,
        lastName,
        email,
      });

      // Get the SEP-10 authentication JWT token
      const token = await getSep10Token(keypair);

      // Save onboarding complete and phone
      await saveRegisteredPhone(phoneNumber);
      await setOnboardingComplete(true);

      // Perform local session login
      await login(publicKey, account.shortId, token);

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
    if (step === 1 || step === 6) return <View style={styles.backButtonPlaceholder} />;
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
    const dotSteps = userFlowType === 'returning' ? [2, 3] : [2, 3, 4, 5, 6];
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
      <View style={styles.keyboardView}>
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
              resizeMode="contain"
            />
            
            <View style={styles.welcomeTextContainer}>
              <Text style={styles.welcomeTitle}>Welcome to</Text>
              <Text style={styles.welcomeAppName}>Pijin!</Text>
              <Text style={styles.welcomeSubtitle}>
                Universal Web3 Liquidity, Powered by Cellular.
              </Text>
            </View>

            {/* Set pointerEvents="none" so clicks pass through the pigeon's feet to the buttons */}
            <View style={styles.welcomePigeonContainer} pointerEvents="none">
              <Image
                source={require('../../assets/onboarding/onboarding-1.png')}
                style={styles.welcomePigeonImage}
                resizeMode="contain"
              />
            </View>

            <View style={styles.welcomeButtonsContainer}>
              <AppButton
                title="Create an account"
                onPress={handleCreateAccount}
                variant="secondary"
                icon={<Ionicons name="person-add-outline" size={24} color="#08090A" />}
              />
              <AppButton
                title="Sign In"
                onPress={handleSignIn}
                variant="outline"
                icon={<Ionicons name="key-outline" size={24} color="#FFFFFF" />}
              />
            </View>
          </View>

          {/* Slide 2: Enter Phone Number */}
          <View style={styles.slide}>
            {/* Shrink illustration height when focused for smooth keyboard avoidance */}
            <View style={styles.illustrationContainer}>
              <Image
                source={require('../../assets/onboarding/onboarding-2.png')}
                style={styles.illustrationImage}
                resizeMode="contain"
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
              {isCheckingUser ? (
                <View style={styles.loadingButton}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.loadingButtonText}>Verifying number...</Text>
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
          </View>

          {/* Slide 3: Verify OTP */}
          <View style={styles.slide}>
            {/* Core form elements grouped tightly to remove dead space */}
            <View style={styles.formContentContainer}>
              <View style={styles.textContainerLeft}>
                <Text style={styles.stepTitleDark}>Verify OTP</Text>
                <Text style={styles.stepSubtitleDark}>
                  We sent a verification code to your mobile number. +63 {phoneNumber ? `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6)}` : '991-598-4988'}
                </Text>
              </View>

              <AppPinInput
                value={otp}
                onChange={setOtp}
                theme="dark"
                length={4}
              />

              <TouchableOpacity style={styles.resendContainer} activeOpacity={0.7}>
                <Text style={styles.resendTextMuted}>Didn't get an OTP? </Text>
                <Text style={styles.resendTextLink}>Resend</Text>
              </TouchableOpacity>
            </View>

            {/* Shrink illustration height when focused for smooth keyboard avoidance */}
            <View style={styles.otpIllustrationContainer}>
              <Image
                source={require('../../assets/onboarding/onboarding-3.png')}
                style={styles.otpIllustrationImage}
                resizeMode="contain"
              />
            </View>

            <View style={styles.footer}>
              <AppButton
                title="Continue"
                onPress={handleOtpContinue}
                variant="secondary"
                icon={<Ionicons name="arrow-forward" size={24} color="#08090A" />}
              />
            </View>
          </View>

          {/* Slide 4: Name & Info (new users only) */}
          <View style={styles.slide}>
            <View style={styles.illustrationContainer}>
              <Image
                source={require('../../assets/onboarding/onboarding-2.png')}
                style={styles.illustrationImage}
                resizeMode="contain"
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
          </View>

          {/* Slide 5: Secure PIN */}
          <View style={styles.slide}>
            {/* Shrink illustration height when focused for smooth keyboard avoidance */}
            <View style={styles.illustrationContainer}>
              <Image
                source={require('../../assets/onboarding/onboarding-4.png')}
                style={styles.illustrationImage}
                resizeMode="contain"
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
                title="Confirm 4-digit pin"
                onPress={handlePinConfirm}
                variant="primary"
                icon={<Ionicons name="checkmark-circle-outline" size={24} color="#FFFFFF" />}
              />
            </View>
          </View>

          {/* Slide 5: Success Screen */}
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
                resizeMode="contain"
              />
            </View>

            <View style={styles.footer}>
              {isRegistering ? (
                <View style={styles.loadingButton}>
                  <ActivityIndicator color="#031634" size="small" />
                  <Text style={[styles.loadingButtonText, { color: '#031634' }]}>Registering account...</Text>
                </View>
              ) : (
                <AppButton
                  title="Enter Pijin"
                  onPress={handleEnterPijin}
                  variant="secondary"
                  icon={<Ionicons name="log-in-outline" size={24} color="#08090A" />}
                />
              )}
            </View>
          </View>
        </ScrollView>

        {/* Static Dots Indicator at the bottom */}
        {renderDots()}
      </View>
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 54,
    marginBottom: -32, // Reverted to original -32
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
    paddingTop: 44,
  },
  illustrationContainer: {
    height: SCREEN_HEIGHT * 0.35, // Reverted to original 0.35
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  illustrationContainerCollapsed: {
    height: SCREEN_HEIGHT * 0.12,
  },
  illustrationImage: {
    width: '110%', // Reverted to original 85%
    height: '100%',
  },
  otpIllustrationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 12,
  },
  otpIllustrationContainerCollapsed: {
    height: SCREEN_HEIGHT * 0.10,
    flex: 0,
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
    paddingBottom: 8,
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
    backgroundColor: '#031634',
    borderRadius: 12,
    height: 56,
    gap: 10,
  },
  loadingButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
