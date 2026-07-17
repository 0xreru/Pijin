import React from 'react';
import { Image } from 'expo-image';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  StatusBar,
  Alert,
  Linking,
  Platform,
  DeviceEventEmitter,
  AppState,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SMS_GATEWAY_NUMBER } from '../constants/api';
import { db } from '../db/client';
import { enqueuePayment } from '../db/services/paymentQueueDb';
import { addTransaction } from '../db/services/transactionDb';
import { OfflineSuccessModal } from '../components/ui/OfflineSuccessModal';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function TransportChoiceScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const qrData = route.params?.qrData || '';
  const hasCommittedRef = React.useRef(false);
  const [isWaitingForSmsReturn, setIsWaitingForSmsReturn] = React.useState(false);
  const [showSuccessModal, setShowSuccessModal] = React.useState(false);

  const commitOfflineTransaction = async (): Promise<boolean> => {
    if (hasCommittedRef.current) return true;

    const payload = route.params?.payload;
    const amount = route.params?.amount ?? 0;
    const total = route.params?.total ?? 0;
    const recipientName = route.params?.recipientName ?? '';
    const recipientShortId = route.params?.recipientShortId ?? '';
    const fee = route.params?.fee ?? 0;

    if (!payload) {
      console.warn('[TransportChoice] No offline payload provided to commit.');
      return false;
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
      return true;
    } catch (err) {
      console.error('[TransportChoice] Failed to commit offline payment:', err);
      return false;
    }
  };

  React.useEffect(() => {
    const handleAppStateChange = (nextAppState: any) => {
      // When the user returns to the app from the native SMS composer
      if (nextAppState === 'active' && isWaitingForSmsReturn) {
        setIsWaitingForSmsReturn(false);

        Alert.alert(
          'Confirm SMS Dispatch',
          'Did you successfully send the text message containing your offline payment voucher?',
          [
            {
              text: 'No, Cancelled',
              style: 'cancel',
              onPress: () => {
                // Reset commitment ref so they can try again if they want
                hasCommittedRef.current = false;
              }
            },
            {
              text: 'Yes, I Sent It',
              onPress: async () => {
                const success = await commitOfflineTransaction();
                if (success) {
                  setShowSuccessModal(true);
                } else {
                  Alert.alert('Error', 'Failed to save the offline transaction locally. Please try again.');
                }
              }
            }
          ],
          { cancelable: false }
        );
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [isWaitingForSmsReturn]);

  const handleChoicePress = async (choice: 'send_phone' | 'scan_me' | 'relay') => {
    if (choice === 'send_phone') {
      if (!qrData) {
        Alert.alert('Error', 'No payload found to send via SMS.');
        return;
      }
      const url = Platform.OS === 'android'
        ? `sms:${SMS_GATEWAY_NUMBER}?body=${encodeURIComponent(qrData)}`
        : `sms:${SMS_GATEWAY_NUMBER}&body=${encodeURIComponent(qrData)}`;
      
      // Set waiting flag before opening native SMS app
      setIsWaitingForSmsReturn(true);

      Linking.openURL(url)
        .catch((err) => {
          setIsWaitingForSmsReturn(false);
          Alert.alert('Error', 'Could not open native messaging app.');
          console.error(err);
        });
    } else if (choice === 'relay') {
      // Defer commit until GenerateQR "Done relaying" is pressed
      navigation.navigate('GenerateQR', { 
        ...route.params, // Pass all payload details
        mode: 'relay', 
        qrData 
      });
    } else {
      // For scan_me, we commit immediately as the voucher is generated and shown
      const success = await commitOfflineTransaction();
      if (success) {
        navigation.navigate('GenerateQR', { mode: 'receiver', qrData });
      } else {
        Alert.alert('Error', 'Failed to save the offline transaction locally. Please try again.');
      }
    }
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
      <StatusBar barStyle="dark-content" />

      {/* Header Back Button */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-undo-outline" size={28} color="#000000" />
        </TouchableOpacity>
      </View>

      {/* Title */}
      <Text style={styles.screenTitle}>How do you want{"\n"}to send this?</Text>

      {/* Content area: Option Cards */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Card 1: SEND USING MY PHONE */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => handleChoicePress('send_phone')}
          activeOpacity={0.85}
        >
          <View style={styles.mascotWrapper}>
            <Image
              source={require('../../assets/transport choice/piji-send.png')}
              style={styles.mascotImage}
              contentFit="contain"
            />
          </View>
          <View style={styles.textWrapper}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, styles.badgeBlue]}>
                <Text style={[styles.badgeText, styles.badgeTextBlue]}>SMS DISPATCH</Text>
              </View>
            </View>
            <Text style={styles.cardTitle}>Send Using My Phone</Text>
            <Text style={styles.cardSubtitle}>
              Standard SMS charges apply. Active text promo required.
            </Text>
          </View>
        </TouchableOpacity>

        {/* Card 2: GET HELP SENDING */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => handleChoicePress('relay')}
          activeOpacity={0.85}
        >
          <View style={styles.mascotWrapper}>
            <Image
              source={require('../../assets/transport choice/piji-relay.png')}
              style={styles.mascotImage}
              contentFit="contain"
            />
          </View>
          <View style={styles.textWrapper}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, styles.badgeGreen]}>
                <Text style={[styles.badgeText, styles.badgeTextGreen]}>OFFLINE RELAY</Text>
              </View>
            </View>
            <Text style={styles.cardTitle}>Get Help Sending</Text>
            <Text style={styles.cardSubtitle}>
              Don't have text load? Show your screen to a partner so they can scan and send for you.
            </Text>
          </View>
        </TouchableOpacity>
      </ScrollView>

      {/* Footer Container */}
      <View style={[styles.footerContainer, { paddingBottom: Math.max(insets.bottom, 15) }]}>
        <Text style={styles.pijinLogo}>p i j i n</Text>
        <TouchableOpacity onPress={() => Alert.alert('Help', 'Support information')} activeOpacity={0.7}>
          <Text style={styles.getHelpLink}>Get help</Text>
        </TouchableOpacity>
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
    paddingVertical: 10,
  },
  backButton: {
    marginRight: 12,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#000000',
    lineHeight: 34,
    marginTop: 15,
    marginBottom: 20,
    paddingHorizontal: 24,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 10,
    flexGrow: 1,
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeBlue: {
    backgroundColor: '#E5F1FF',
  },
  badgeGreen: {
    backgroundColor: '#E6F9EE',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  badgeTextBlue: {
    color: '#0054B4',
  },
  badgeTextGreen: {
    color: '#107C41',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    height: 180,
    marginBottom: 20,
    // Premium navy-tinted drop shadow
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  mascotWrapper: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascotImage: {
    width: 120,
    height: 120,
  },
  textWrapper: {
    flex: 1,
    paddingLeft: 20,
    paddingRight: 4,
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#04295A',
    letterSpacing: 0.2,
    marginBottom: 6,
    lineHeight: 24,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#707984',
    lineHeight: 19,
  },
  footerContainer: {
    borderTopWidth: 1,
    borderTopColor: '#D1D5DB',
    width: '100%',
    paddingTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
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
});
