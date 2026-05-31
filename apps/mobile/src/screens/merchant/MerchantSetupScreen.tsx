import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppButton } from '../../components/ui/AppButton';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors, shadows } from '../../constants/theme';
import { typography } from '../../constants/typography';
import { registerAccount } from '../../services/api/accounts';
import { saveStoredAccount } from '../../services/storage/accountStorage';
import { connectStellarWallet } from '../../services/wallet/walletConnector';
import { getOrGenerateDeviceKeypair } from '../../services/wallet/deviceKeyStore';

type MerchantSetupScreenProps = {
  onBack?: () => void;
  onRegistered?: (publicKey: string, shortId: string) => void;
};

export function MerchantSetupScreen({ onBack, onRegistered }: MerchantSetupScreenProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConnectWallet() {
    setIsConnecting(true);
    setMessage(null);
    setError(null);
    try {
      const result = await connectStellarWallet();
      setPublicKey(result.publicKey);
      setMessage(`Wallet connected: ${shorten(result.publicKey)}`);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Wallet connection failed.');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleRegisterMerchant() {
    if (!publicKey) {
      setError('Connect wallet first.');
      return;
    }
    if (!phoneNumber.trim()) {
      setError('Phone number required.');
      return;
    }

    setIsRegistering(true);
    setMessage(null);
    setError(null);
    try {
      const deviceKeypair = await getOrGenerateDeviceKeypair();
      const registered = await registerAccount({
        role: 'MERCHANT',
        stellarPublicKey: publicKey,
        offlineDeviceKey: deviceKeypair.publicKey(),
        merchantPin: '1234',
        merchantPhone: phoneNumber.trim(),
      });

      await saveStoredAccount({
        shortId: registered.shortId,
        role: registered.role,
        stellarPublicKey: registered.stellarPublicKey,
        merchantPin: registered.merchantPin,
      });

      setMessage(`Merchant registered: ${registered.shortId}`);
      onRegistered?.(publicKey, registered.shortId);
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : 'Merchant registration failed.');
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <ScreenContainer scroll={false} contentStyle={styles.screen}>
      <View style={styles.backWrap}>
        <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={onBack}>
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.body}>
          <Text style={styles.title}>Merchant Setup</Text>
          <Text style={styles.description}>Connect wallet, add merchant phone, register merchant short ID.</Text>

          <AppButton
            title={isConnecting ? 'Connecting...' : 'Connect Wallet'}
            onPress={handleConnectWallet}
            disabled={isConnecting}
            icon={<Ionicons name="link-outline" size={18} color={colors.surface} />}
            style={styles.connectButton}
          />

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>PHONE NUMBER</Text>
            <TextInput
              style={styles.input}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              placeholder="+639XXXXXXXXX"
              placeholderTextColor="rgba(8, 9, 10, 0.35)"
            />
          </View>

          <AppButton
            title={isRegistering ? 'Registering...' : 'Register Merchant'}
            onPress={handleRegisterMerchant}
            disabled={isRegistering || !publicKey}
            icon={<Ionicons name="checkmark-circle-outline" size={18} color={colors.surface} />}
            style={styles.registerButton}
          />

          {message ? <Text style={styles.message}>{message}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function shorten(value: string) {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + spacing.md : spacing.md,
  },
  backWrap: {
    height: 48,
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.soft,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  body: {
    gap: spacing.lg,
  },
  title: {
    ...typography.title,
    fontSize: 28,
    fontWeight: '900',
    color: colors.ink,
  },
  description: {
    ...typography.body,
    color: colors.muted,
    fontWeight: '600',
  },
  connectButton: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
  },
  fieldWrap: {
    gap: spacing.xs,
  },
  label: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: '900',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontWeight: '700',
  },
  registerButton: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
  },
  message: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
});
