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
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BUTTON_WIDTH = 52;
const TRACK_WIDTH = SCREEN_WIDTH - 40;
const MAX_SWIPE = TRACK_WIDTH - BUTTON_WIDTH - 8;

export function LoadOfflineFundsScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { balance } = route.params || { balance: 25000 };

  // States
  const [inputText, setInputText] = useState('');
  const [numericVal, setNumericVal] = useState(0);
  const numericValRef = useRef(0);
  const [formattedAmount, setFormattedAmount] = useState('0.00');
  const [isLoading, setIsLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
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
              ]).start(() => {
                setIsLoading(true);
                // Reset swipe anim for next launch
                swipeAnim.setValue(0);

                setTimeout(() => {
                  setIsLoading(false);
                  setModalVisible(true);
                }, 1800);
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
    setModalVisible(false);
    
    try {
      const { addTransaction } = require('../db/services/transactionDb');
      await addTransaction({
        title: 'Online to Offline Transfer',
        amount: -numericVal,
        type: 'transfer',
        tag: 'WALLET',
        description: `Moved ₱${numericVal.toFixed(2)} from online wallet to offline vault.`,
      });
      await addTransaction({
        title: 'Received from Online Wallet',
        amount: numericVal,
        type: 'transfer',
        tag: 'OFFLINE',
        description: `Received ₱${numericVal.toFixed(2)} from online wallet.`,
      });
      // Emit event to deduct online balance and add to offline balance
      DeviceEventEmitter.emit('ON_LOAD_OFFLINE_FUNDS', numericVal);
    } catch (err) {
      console.error('Failed to log load offline funds transaction:', err);
      return;
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
          Online wallet to{'\n'}Offline Funds
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
