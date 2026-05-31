import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../components/ui/AppButton';
import { ScreenContainer } from '../components/ui/ScreenContainer';
import { WalletModeCard } from '../components/wallet/WalletModeCard';
import { radius } from '../constants/radius';
import { spacing } from '../constants/spacing';
import { colors, shadows } from '../constants/theme';
import { typography } from '../constants/typography';
import { WalletMode } from '../types/wallet';

type CustomerOnlineScreenProps = {
  onContinue?: (mode: 'customer' | 'merchant') => void;
};

export function CustomerOnlineScreen({ onContinue }: CustomerOnlineScreenProps) {
  const [selectedMode, setSelectedMode] = useState<WalletMode>('personal');
  const [message, setMessage] = useState<string | null>(null);

  function handleContinue() {
    setMessage(null);
    onContinue?.(selectedMode === 'personal' ? 'customer' : 'merchant');
  }

  return (
    <ScreenContainer scroll={false} contentStyle={styles.screen}>
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>How will you use{'\n'}AbotPera?</Text>
          <Text style={styles.subtitle}>You can change this later in settings.</Text>
        </View>

        <View style={styles.cards}>
          <WalletModeCard
            title="Personal Wallet"
            description="Lock funds and pay offline."
            selected={selectedMode === 'personal'}
            tone="light"
            icon="wallet"
            onPress={() => {
              setSelectedMode('personal');
              setMessage(null);
            }}
          />
          <WalletModeCard
            title="Merchant Wallet"
            description="Accept offline payments from customer"
            selected={selectedMode === 'merchant'}
            tone="dark"
            icon="merchant"
            onPress={() => setSelectedMode('merchant')}
          />
        </View>
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <AppButton
        title="CONTINUE"
        style={styles.button}
        onPress={handleContinue}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  content: {
    marginTop: spacing.sm,
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
  copy: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.title,
    fontSize: 28,
    lineHeight: 34,
    color: colors.ink,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  cards: {
    gap: spacing.lg,
  },
  button: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    alignSelf: 'stretch',
    marginTop: 48,
    ...shadows.card,
  },
  message: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.lg,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
});
