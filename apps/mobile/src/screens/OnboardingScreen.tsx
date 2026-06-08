import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  Alert,
  Dimensions,
  ScrollView,
  LayoutAnimation,
  UIManager,
  Animated,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppButton } from '../components/ui/AppButton';
import { AppPinInput } from '../components/ui/AppPinInput';
import { setOnboardingComplete, saveUserPin } from '../services/storage/onboardingStorage';
import { StatusBar } from 'expo-status-bar';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const ONBOARDING_DARK_BLUE = '#031634';
const ONBOARDING_LIGHT_GRAY = '#EDEDED';

type RootStackParamList = {
  Onboarding: undefined;
  Dashboard: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

export function OnboardingScreen() {
  const navigation = useNavigation<NavigationProp>();
  const scrollViewRef = useRef<ScrollView>(null);
  
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [maxAllowedStep, setMaxAllowedStep] = useState<number>(1);

  // Focus States to hide illustrations during input
  const [isPhoneFocused, setIsPhoneFocused] = useState(false);
  const [isOtpFocused, setIsOtpFocused] = useState(false);
  const [isPinFocused, setIsPinFocused] = useState(false);

  // Form States
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [otp, setOtp] = useState('');
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

  const isDark = step === 1 || step === 3 || step === 5;

  const handleFocusChange = (focused: boolean, type: 'phone' | 'otp' | 'pin') => {
    // Smoothly animate the layout resizing when keyboard is shown/hidden
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (type === 'phone') {
      setIsPhoneFocused(focused);
    } else if (type === 'otp') {
      setIsOtpFocused(focused);
    } else if (type === 'pin') {
      setIsPinFocused(focused);
    }
  };

  const navigateToStep = (targetStep: 1 | 2 | 3 | 4 | 5) => {
    if (targetStep > maxAllowedStep) {
      setMaxAllowedStep(targetStep);
    }
    
    // Smooth transition between steps
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
    Alert.alert('Sign In', 'Sign-in feature is coming soon! Please use "Create an account" for now.');
  };

  const handleSendOtp = () => {
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanNumber.length !== 10) {
      setPhoneError('Please enter a valid 10-digit phone number (e.g. 9123456789)');
      return;
    }
    setPhoneError('');
    navigateToStep(3);
  };

  const handleOtpContinue = () => {
    if (otp.length !== 4) {
      Alert.alert('Invalid OTP', 'Please enter a 4-digit OTP.');
      return;
    }
    navigateToStep(4);
  };

  const handlePinConfirm = async () => {
    if (pin.length !== 4) {
      Alert.alert('Invalid PIN', 'Please enter a 4-digit PIN.');
      return;
    }
    try {
      await saveUserPin(pin);
      navigateToStep(5);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to secure PIN. Please try again.');
    }
  };

  const handleEnterPijin = async () => {
    try {
      await setOnboardingComplete(true);
      navigation.reset({
        index: 0,
        routes: [{ name: 'Dashboard' }],
      });
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to complete onboarding. Please try again.');
    }
  };

  const handleBack = () => {
    if (step > 1) {
      navigateToStep((step - 1) as any);
    }
  };

  const renderBackArrow = () => {
    if (step === 1) return <View style={styles.backButtonPlaceholder} />;
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
    return (
      <View style={styles.dotsContainer}>
        {[1, 2, 3, 4, 5].map((i) => {
          // Dynamic width animation: active dot stretches to 24, inactive are 8
          const dotWidth = activeStepAnimated.interpolate({
            inputRange: [i - 1, i, i + 1],
            outputRange: [8, 24, 8],
            extrapolate: 'clamp',
          });

          // Dynamic opacity animation: active dot is 1, inactive dots are translucent (0.35)
          const dotOpacity = activeStepAnimated.interpolate({
            inputRange: [i - 1, i, i + 1],
            outputRange: [0.35, 1, 0.35],
            extrapolate: 'clamp',
          });

          // Theme color logic: white on dark background, dark blue on light background
          const dotColor = isDark ? '#FFFFFF' : '#031634';

          return (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                {
                  width: dotWidth,
                  opacity: dotOpacity,
                  backgroundColor: dotColor,
                },
              ]}
            />
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: isDark ? ONBOARDING_DARK_BLUE : ONBOARDING_LIGHT_GRAY }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
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
            <View style={[
              styles.illustrationContainer,
              isPhoneFocused && styles.illustrationContainerCollapsed
            ]}>
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
                    onFocus={() => handleFocusChange(true, 'phone')}
                    onBlur={() => handleFocusChange(false, 'phone')}
                  />
                </View>
              </View>
              {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
            </View>

            <View style={styles.footer}>
              <AppButton
                title="Send OTP"
                onPress={handleSendOtp}
                variant="primary"
                icon={<Ionicons name="paper-plane-outline" size={24} color="#FFFFFF" />}
              />
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
                onFocus={() => handleFocusChange(true, 'otp')}
                onBlur={() => handleFocusChange(false, 'otp')}
              />

              <TouchableOpacity style={styles.resendContainer} activeOpacity={0.7}>
                <Text style={styles.resendTextMuted}>Didn't get an OTP? </Text>
                <Text style={styles.resendTextLink}>Resend</Text>
              </TouchableOpacity>
            </View>

            {/* Shrink illustration height when focused for smooth keyboard avoidance */}
            <View style={[
              styles.otpIllustrationContainer,
              isOtpFocused && styles.otpIllustrationContainerCollapsed
            ]}>
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

          {/* Slide 4: Secure PIN */}
          <View style={styles.slide}>
            {/* Shrink illustration height when focused for smooth keyboard avoidance */}
            <View style={[
              styles.illustrationContainer,
              isPinFocused && styles.illustrationContainerCollapsed
            ]}>
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
                onFocus={() => handleFocusChange(true, 'pin')}
                onBlur={() => handleFocusChange(false, 'pin')}
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
              <AppButton
                title="Enter Pijin"
                onPress={handleEnterPijin}
                variant="secondary"
                icon={<Ionicons name="log-in-outline" size={24} color="#08090A" />}
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
    paddingBottom: 8,
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
});
