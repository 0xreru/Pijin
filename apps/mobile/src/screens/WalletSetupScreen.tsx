import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { AppButton } from '../components/ui/AppButton';
import { ScreenContainer } from '../components/ui/ScreenContainer';
import { radius } from '../constants/radius';
import { spacing } from '../constants/spacing';
import { colors, shadows } from '../constants/theme';
import { typography } from '../constants/typography';
import { registerAccount, type AccountRole } from '../services/api/accounts';
import { connectStellarWallet } from '../services/wallet/walletConnector';
import { getOrGenerateDeviceKeypair } from '../services/wallet/deviceKeyStore';
import { saveStoredAccount } from '../services/storage/accountStorage';

type WalletSetupScreenProps = {
  userMode: 'customer' | 'merchant';
  onBack?: () => void;
  onWalletConnected?: (publicKey: string, shortId: string) => void;
};

export function WalletSetupScreen({
  userMode,
  onBack,
  onWalletConnected,
}: WalletSetupScreenProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [pairingUri, setPairingUri] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  const [merchantPin, setMerchantPin] = useState('1234');
  const [merchantPhone, setMerchantPhone] = useState('');

  async function handleConnectWallet() {
    setIsConnecting(true);
    setPairingUri(null);
    setConnectionError(null);
    setDeepLinkMessage(null);

    try {
      console.log("1. Waiting for WalletConnect...");
      const { publicKey } = await connectStellarWallet({
        onPairingUri: (uri) => {
          setPairingUri(uri);
          setDeepLinkMessage('Opening Freighter. If it does not appear, scan the QR below.');
        },
        onDeepLinkStatus: (status) => {
          if (status.opened) {
            setDeepLinkMessage('Freighter opened. Approve the connection in your wallet.');
            return;
          }
          if (!status.canOpen) {
            setDeepLinkMessage('Open Freighter and scan the QR below.');
            return;
          }
          setDeepLinkMessage('Freighter did not open automatically. Open Freighter and scan the QR below.');
        },
      });
      console.log("2. WalletConnect Finished! Key:", publicKey);

      const deviceKeypair = await getOrGenerateDeviceKeypair();
      const offlineDeviceKey = deviceKeypair.publicKey();

      const role: AccountRole = userMode === 'merchant' ? 'MERCHANT' : 'CUSTOMER';

      console.log("3. Calling Backend API...");
      const registered = await registerAccount({
        role,
        stellarPublicKey: publicKey,
        offlineDeviceKey,
        merchantPin: userMode === 'merchant' ? merchantPin : undefined,
        merchantPhone: userMode === 'merchant' ? merchantPhone : undefined,
      });
      console.log("4. Backend API Response:", registered);
      
      await saveStoredAccount({
        shortId: registered.shortId,
        role: registered.role,
        stellarPublicKey: registered.stellarPublicKey,
        merchantPin: registered.merchantPin,
      });

      setPairingUri(null);
      setDeepLinkMessage(null);
      onWalletConnected?.(publicKey, registered.shortId);
    } catch (error) {
      setPairingUri(null);
      setDeepLinkMessage(null);
      setConnectionError(error instanceof Error ? error.message : 'Wallet connection failed.');
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <ScreenContainer scroll={false} contentStyle={styles.screen}>
      <BackHeader onBack={onBack} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.body}>
          <View style={styles.logoContainer}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.title}>Connect Your Wallet</Text>
          <Text style={styles.description}>
            Link a Stellar mainnet wallet, then register your {userMode} account with the AbotPera
            backend to get a short ID for SMS payments.
          </Text>

          {userMode === 'merchant' ? (
            <View style={styles.merchantFields}>
              <View style={styles.fieldWrap}>
                <Text style={styles.pinLabel}>MERCHANT PHONE (FOR TEXTBEE)</Text>
                <TextInput
                  style={styles.pinInput}
                  value={merchantPhone}
                  onChangeText={setMerchantPhone}
                  keyboardType="phone-pad"
                  placeholder="+639XX..."
                  placeholderTextColor="rgba(8, 9, 10, 0.3)"
                />
              </View>
              <View style={styles.fieldWrap}>
                <Text style={styles.pinLabel}>MERCHANT PIN (4 DIGITS, FOR SMS RECEIPTS)</Text>
                <TextInput
                  style={styles.pinInput}
                  value={merchantPin}
                  onChangeText={setMerchantPin}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder="1234"
                  placeholderTextColor="rgba(8, 9, 10, 0.3)"
                />
              </View>
            </View>
          ) : null}

          <View style={styles.actions}>
            <AppButton
              title={isConnecting ? 'Connecting...' : 'Connect LOBSTR'}
              icon={<Ionicons name="link-outline" size={20} color={colors.surface} />}
              disabled={isConnecting}
              onPress={handleConnectWallet}
              style={styles.connectButton}
            />
          </View>

          {pairingUri ? <WalletConnectQrCard pairingUri={pairingUri} /> : null}

          {deepLinkMessage ? <Text style={styles.deepLinkMessage}>{deepLinkMessage}</Text> : null}
          {connectionError ? <Text style={styles.error}>{connectionError}</Text> : null}
        </View>

        <Text style={styles.terms}>
          By connecting, you agree to our Terms of Service. Keys remain on your device; the backend
          only stores your public key and short ID.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function BackHeader({ onBack }: { onBack?: () => void }) {
  return (
    <View style={styles.backWrap}>
      <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={onBack}>
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </Pressable>
    </View>
  );
}

function WalletConnectQrCard({ pairingUri }: { pairingUri: string }) {
  return (
    <View style={styles.qrCard}>
      <Text style={styles.qrTitle}>Scan with Freighter</Text>
      <View style={styles.qrWrap}>
        <QRCode value={pairingUri} size={156} backgroundColor={colors.surface} color={colors.ink} />
      </View>
      <Text style={styles.qrHelper}>
        If Freighter did not open automatically, open Freighter and scan this WalletConnect QR.
      </Text>
    </View>
  );
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
  pressed: {
    opacity: 0.85,
  },
  body: {
    paddingTop: spacing.sm,
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  logo: {
    width: 160,
    height: 160,
    borderRadius: radius.xxl,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 140,
  },
  title: {
    ...typography.title,
    fontSize: 28,
    lineHeight: 34,
    color: colors.ink,
    fontWeight: '900',
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    textAlign: 'center',
  },
  merchantFields: {
    marginTop: spacing.xl,
    gap: spacing.lg,
  },
  fieldWrap: {
    gap: spacing.xs,
  },
  pinLabel: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  pinInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontWeight: '700',
    ...shadows.soft,
  },
  actions: {
    marginTop: spacing.xl,
  },
  connectButton: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  qrCard: {
    marginTop: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadows.soft,
  },
  qrTitle: {
    ...typography.caption,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '900',
  },
  qrWrap: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qrHelper: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  deepLinkMessage: {
    ...typography.caption,
    color: colors.mutedDark,
    textAlign: 'center',
    marginTop: spacing.md,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.lg,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  terms: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
});
