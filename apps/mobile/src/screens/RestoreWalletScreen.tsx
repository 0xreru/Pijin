import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Keyboard,
  Dimensions,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { AppButton } from '../components/ui/AppButton';
import { deriveKeysFromMnemonic } from '../services/wallet/mnemonic';
import { checkUserExists } from '../services/api/accounts';
import { getSep10Token } from '../services/stellar/anchorService';
import { useAuth } from '../context/AuthContext';
import {
  saveMainWalletSecret,
  setOnboardingComplete,
} from '../services/storage/onboardingStorage';
import { saveDeviceKey } from '../services/wallet/offlineKeySync'; // We'll need a way to save the device key locally. Wait, deviceKeyStore has this.

// We should import getOrGenerateDeviceKeypair... wait, we need to save the derived device key directly.
import * as SecureStore from 'expo-secure-store';
import { ensureMigration } from '../services/storage/migration';
import { synchronizeRecipientRegistry } from '../services/wallet/recipientRegistrySync';
import { synchronizeOfflineDeviceKey } from '../services/wallet/offlineKeySync';

export function RestoreWalletScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  
  // Get phone from route if passed, or we just rely on checkUserExists phone parameter
  const phoneNumber = route.params?.phoneNumber;

  const [phrase, setPhrase] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleRestore = async () => {
    const cleanPhrase = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
    const words = cleanPhrase.split(' ');

    if (words.length !== 12) {
      Alert.alert('Invalid Phrase', 'Please enter exactly 12 words separated by spaces.');
      return;
    }

    setIsRestoring(true);

    // Yield to the UI thread so the button loading state renders immediately
    // before the heavy cryptographic key derivation blocks the main thread.
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      // 1. Derive Keys
      const { mainWalletKeypair, deviceKeypair } = deriveKeysFromMnemonic(cleanPhrase);
      const derivedPublicKey = mainWalletKeypair.publicKey();

      // 2. Fetch expected public key from backend
      if (!phoneNumber) {
        throw new Error('Phone number is missing from route params.');
      }
      const checkRes = await checkUserExists(phoneNumber);

      if (!checkRes.exists || !checkRes.stellarPublicKey) {
        throw new Error('Account not found on the network.');
      }

      // 3. Compare Keys
      if (derivedPublicKey !== checkRes.stellarPublicKey) {
        throw new Error('The seed phrase provided does not match this account. Please check your spelling and order.');
      }

      // 4. Save Keys to SecureStore
      await saveMainWalletSecret(mainWalletKeypair.secret());
      await ensureMigration();
      await SecureStore.setItemAsync('pijn.device.secret', deviceKeypair.secret());
      
      // 5. Authenticate and Log In
      const token = await getSep10Token(mainWalletKeypair);
      await synchronizeRecipientRegistry(token);
      await synchronizeOfflineDeviceKey(mainWalletKeypair, token);
      
      await login(checkRes.stellarPublicKey, checkRes.shortId, token);

      await setOnboardingComplete(true);

      navigation.reset({
        index: 0,
        routes: [{ name: 'Dashboard' }],
      });

    } catch (e: any) {
      console.error('[RestoreWallet] Error:', e);
      Alert.alert('Restore Failed', e.message || 'Failed to restore wallet. Please try again.');
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#031634" />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Restore Wallet</Text>
        <Text style={styles.subtitle}>
          Enter your 12-word seed phrase in the correct order to recover your secure keys.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="e.g. apple banana cherry..."
          placeholderTextColor="#9CA3AF"
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          value={phrase}
          onChangeText={setPhrase}
          editable={!isRestoring}
        />

        <View style={styles.illustrationContainer}>
          <Image
            source={require('../../assets/seed phrase/piji-restore.png')}
            style={styles.illustrationImage}
            contentFit="contain"
          />
        </View>

        <View style={styles.tipContainer}>
          <Ionicons name="warning-outline" size={16} color="#B45309" />
          <Text style={styles.tipText}>
            Ensure no one is watching your screen while you enter this phrase.
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <AppButton
          title={isRestoring ? "Restoring Secure Keys..." : "Restore Account"}
          onPress={handleRestore}
          variant="primary"
          icon={<Ionicons name="shield-checkmark" size={24} color="#FFFFFF" />}
          loading={isRestoring}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EDEDED',
  },
  header: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  backButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#031634',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#4B5563',
    marginBottom: 24,
    lineHeight: 22,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#031634',
    minHeight: 120,
    textAlignVertical: 'top',
  },
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
    gap: 8,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: '#B45309',
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  loadingButton: {
    backgroundColor: '#031634',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
  },
  loadingButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  illustrationContainer: {
    height: Dimensions.get('window').height * 0.25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  illustrationContainerCollapsed: {
    display: 'none',
  },
  illustrationImage: {
    width: '80%',
    height: '100%',
  },
});
