import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ui/ScreenContainer';
import { radius } from '../constants/radius';
import { spacing } from '../constants/spacing';
import { colors, shadows } from '../constants/theme';
import { typography } from '../constants/typography';

type PayAmountScreenProps = {
  connectedPublicKey?: string;
  onBack?: () => void;
  onGenerateQr?: (amount: number) => void;
};

const MVP_OFFLINE_VAULT_LIMIT = 5000;
const PESO = '✦';
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'] as const;

export function PayAmountScreen({
  connectedPublicKey,
  onBack,
  onGenerateQr,
}: PayAmountScreenProps) {
  const [amount, setAmount] = useState('');
  const amountNumber = Number(amount);
  const canGenerate = amount !== '' && !amount.endsWith('.') && amountNumber > 0 && amountNumber <= MVP_OFFLINE_VAULT_LIMIT;

  function handleKeyPress(key: (typeof keys)[number]) {
    if (key === 'backspace') {
      setAmount((current) => current.slice(0, -1));
      return;
    }

    setAmount((current) => nextAmountValue(current, key));
  }

  function handleGenerateQr() {
    if (!canGenerate) {
      return;
    }

    onGenerateQr?.(amountNumber);
  }

  return (
    <ScreenContainer scroll={false} backgroundColor={colors.surface} contentStyle={styles.screen}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={onBack}>
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
        </View>

        <View style={styles.amountSection}>
          <Text style={styles.label}>AMOUNT TO PAY</Text>
          <Text style={[styles.amountText, !amount && styles.amountPlaceholder]}>
            {PESO}{amount || '0.00'}
          </Text>

          <View style={styles.vaultBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.vaultText}>Local Vault Limit: {PESO}5,000</Text>
          </View>
          <Text style={styles.walletText}>
            {connectedPublicKey ? `Customer Wallet: ${shortenPublicKey(connectedPublicKey)}` : 'No customer wallet connected'}
          </Text>
        </View>

        <View style={styles.keypadSection}>
          {keys.map((key) => (
            <Pressable
              key={key}
              style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
              onPress={() => handleKeyPress(key)}
            >
              {key === 'backspace' ? (
                <Ionicons name="backspace-outline" size={24} color={colors.ink} />
              ) : (
                <Text style={styles.keyText}>{key}</Text>
              )}
            </Pressable>
          ))}
        </View>

        <View style={styles.actionSection}>
          <Pressable
            style={({ pressed }) => [
              styles.generateButton,
              !canGenerate && styles.generateButtonDisabled,
              pressed && canGenerate && styles.pressed,
            ]}
            disabled={!canGenerate}
            onPress={handleGenerateQr}
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.surface} />
            <Text style={styles.generateText}>Generate Payment QR</Text>
          </Pressable>
        </View>
      </View>
    </ScreenContainer>
  );
}

function nextAmountValue(current: string, key: string) {
  if (key === '.') {
    if (current.includes('.')) {
      return current;
    }

    return current === '' ? '0.' : `${current}.`;
  }

  const next = normalizeDigitAppend(current, key);

  if (!isAllowedAmount(next)) {
    return current;
  }

  return next;
}

function normalizeDigitAppend(current: string, digit: string) {
  if (current === '0') {
    return digit;
  }

  return `${current}${digit}`;
}

function isAllowedAmount(value: string) {
  if (!/^\d+(\.\d{0,7})?$/.test(value)) {
    return false;
  }

  if (/^0\d/.test(value)) {
    return false;
  }

  return Number(value) <= MVP_OFFLINE_VAULT_LIMIT;
}

function shortenPublicKey(publicKey: string) {
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + spacing.md : spacing.md,
  },
  root: {
    flex: 1,
    paddingBottom: spacing.xl,
  },
  header: {
    height: 48,
    justifyContent: 'center',
    marginBottom: spacing.lg,
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
  amountSection: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  amountText: {
    color: colors.ink,
    fontSize: 56,
    fontWeight: '900',
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  amountPlaceholder: {
    color: 'rgba(8, 9, 10, 0.15)',
  },
  vaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(16, 185, 129, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  vaultText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  walletText: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  keypadSection: {
    marginTop: 'auto',
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
    marginBottom: spacing.xl,
  },
  key: {
    width: '33.3333%',
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    opacity: 0.4,
  },
  keyText: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: '700',
  },
  actionSection: {
    marginTop: 'auto',
  },
  generateButton: {
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    ...shadows.card,
  },
  generateButtonDisabled: {
    opacity: 0.2,
  },
  generateText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '900',
  },
});
