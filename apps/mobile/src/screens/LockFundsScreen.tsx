import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { AmountDisplay } from '../components/funds/AmountDisplay';
import { NumericKeypad } from '../components/funds/NumericKeypad';
import { SwipeActionButton } from '../components/funds/SwipeActionButton';
import { ScreenContainer } from '../components/ui/ScreenContainer';
import { radius } from '../constants/radius';
import { spacing } from '../constants/spacing';
import { colors, shadows } from '../constants/theme';
import { typography } from '../constants/typography';
import { useAmountKeypad } from '../hooks/useAmountKeypad';
import { useStellarAccount } from '../hooks/useStellarAccount';
import { useVaultBalance } from '../hooks/useVaultBalance';
import { depositToVault, waitForTransaction, type DepositStage } from '../services/soroban/deposit';
import { clearPendingSignatureLock } from '../services/wallet/walletConnector';

type LockFundsScreenProps = {
  connectedPublicKey?: string;
  shortId?: string;
  onBack?: () => void;
  onDepositComplete?: () => void;
};

export function LockFundsScreen({
  connectedPublicKey,
  shortId,
  onBack,
  onDepositComplete,
}: LockFundsScreenProps) {
  const { account, isLoading, error } = useStellarAccount(connectedPublicKey);
  const vault = useVaultBalance(shortId, connectedPublicKey);
  const keypad = useAmountKeypad('1');
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositMessage, setDepositMessage] = useState<string | null>(null);
  const depositInFlightRef = useRef(false);

  const walletStatus = getWalletStatus({ connectedPublicKey, account, isLoading, error });
  const vaultLabel =
    vault.balanceXlm !== null
      ? `Vault locked: ${vault.balanceXlm.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 })} XLM`
      : vault.isLoading
        ? 'Loading vault balance...'
        : vault.error ?? 'Vault balance unavailable';

  async function handleDeposit() {
    if (depositInFlightRef.current) {
      return;
    }

    if (!connectedPublicKey) {
      setDepositMessage('Connect a wallet first.');
      return;
    }

    const amountXlm = keypad.amount;
    if (!Number.isFinite(amountXlm) || amountXlm <= 0) {
      setDepositMessage('Enter a positive amount.');
      return;
    }

    depositInFlightRef.current = true;
    setIsDepositing(true);
    setDepositMessage('Preparing deposit...');
    try {
      const { hash } = await depositToVault({
        customerPublicKey: connectedPublicKey,
        amountXlm,
        onStage: (stage) => {
          setDepositMessage(stageToMessage(stage));
        },
      });
      if (hash) {
        setDepositMessage('Submitting deposit to network...');
        await waitForTransaction(hash);
      }
      await vault.refresh();
      setDepositMessage(`Deposited ${amountXlm} XLM into your on-chain vault.`);
      onDepositComplete?.();
    } catch (err) {
      setDepositMessage(err instanceof Error ? err.message : 'Deposit failed.');
    } finally {
      depositInFlightRef.current = false;
      setIsDepositing(false);
    }
  }

  return (
    <ScreenContainer scroll={false} contentStyle={styles.screen}>
      <ScreenHeader
        title="Lock Funds"
        onBack={() => {
          depositInFlightRef.current = false;
          setIsDepositing(false);
          clearPendingSignatureLock();
          onBack?.();
        }}
      />
      <AmountDisplay label="AMOUNT TO LOCK (XLM)" amount={keypad.amount} badge={walletStatus} />
      <Text style={styles.vaultStatus}>{vaultLabel}</Text>
      {depositMessage ? <Text style={styles.depositMessage}>{depositMessage}</Text> : null}

      <View style={styles.keypadWrap}>
        <NumericKeypad onPressKey={keypad.pressKey} />
      </View>

      <SwipeActionButton
        label={isDepositing ? 'DEPOSITING...' : 'SWIPE TO DEPOSIT TO VAULT'}
        disabled={isDepositing}
        onComplete={handleDeposit}
      />
    </ScreenContainer>
  );
}

function stageToMessage(stage: DepositStage): string {
  switch (stage) {
    case 'load-account':
      return 'Loading account...';
    case 'build-xdr':
      return 'Building transaction...';
    case 'simulate':
      return 'Simulating on Soroban...';
    case 'assemble':
      return 'Assembling final transaction...';
    case 'prepare-sign':
      return 'Preparing wallet signature...';
    case 'wallet-sign':
      return 'Opening Lobstr for signature...';
    case 'send':
      return 'Sending signed transaction...';
    default:
      return 'Processing deposit...';
  }
}

function getWalletStatus({
  connectedPublicKey,
  account,
  isLoading,
  error,
}: {
  connectedPublicKey?: string;
  account: ReturnType<typeof useStellarAccount>['account'];
  isLoading: boolean;
  error: string | null;
}) {
  if (!connectedPublicKey) {
    return 'Connect wallet';
  }
  if (isLoading) {
    return 'Loading Horizon...';
  }
  if (error) {
    return error;
  }
  if (account && !account.exists) {
    return 'Fund mainnet account for fees.';
  }
  return `XLM ${account?.xlmBalance ?? '0'}`;
}

function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <View style={styles.headerRow}>
      <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={onBack}>
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + spacing.md : spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
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
  headerTitle: {
    ...typography.title,
    fontSize: 20,
    fontWeight: '900',
    color: colors.ink,
  },
  vaultStatus: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontWeight: '700',
    fontSize: 13,
  },
  depositMessage: {
    ...typography.caption,
    color: colors.primary,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontWeight: '900',
    fontSize: 13,
  },
  keypadWrap: {
    flex: 1,
    justifyContent: 'center',
    marginVertical: spacing.md,
  },
});
