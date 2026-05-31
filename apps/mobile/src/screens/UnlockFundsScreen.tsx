import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { AmountDisplay } from '../components/funds/AmountDisplay';
import { NumericKeypad } from '../components/funds/NumericKeypad';
import { SwipeActionButton } from '../components/funds/SwipeActionButton';
import { ScreenContainer } from '../components/ui/ScreenContainer';
import { spacing } from '../constants/spacing';
import { colors } from '../constants/theme';
import { typography } from '../constants/typography';
import { useAmountKeypad } from '../hooks/useAmountKeypad';
import { useStellarAccount } from '../hooks/useStellarAccount';
import { useVaultBalance } from '../hooks/useVaultBalance';

type UnlockFundsScreenProps = {
  connectedPublicKey?: string;
  shortId?: string;
};

export function UnlockFundsScreen({ connectedPublicKey, shortId }: UnlockFundsScreenProps) {
  const { account, isLoading, error } = useStellarAccount(connectedPublicKey);
  const vault = useVaultBalance(shortId, connectedPublicKey);
  const initialAmount =
    vault.balanceXlm !== null ? String(Number(vault.balanceXlm.toFixed(7))) : '0';
  const keypad = useAmountKeypad(initialAmount);
  const badge = getBadgeText({ connectedPublicKey, account, isLoading, error });

  return (
    <ScreenContainer scroll={false} contentStyle={styles.screen}>
      <ScreenHeader title="UNLOCK FUND" />
      <AmountDisplay label="AMOUNT TO REFUND (XLM)" amount={keypad.amount} badge={badge} />
      <View style={styles.keypadWrap}>
        <NumericKeypad onPressKey={keypad.pressKey} />
      </View>
      <SwipeActionButton
        title="SWIPE TO PREPARE MVP REFUND"
        onPress={() =>
          Alert.alert(
            'MVP placeholder',
            `${formatXlm(keypad.amount)} is not unlocked on-chain yet. TODO: replace with Soroban escrow refund.`
          )
        }
      />
    </ScreenContainer>
  );
}

function getBadgeText({
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
    return 'Loading XLM balance...';
  }

  if (error) {
    return 'Unable to load XLM balance.';
  }

  if (account && !account.exists) {
    return 'No mainnet account found.';
  }

  if (account) {
    return `XLM ${account.xlmBalance}`;
  }

  return 'XLM 0';
}

function formatXlm(value: number | string): string {
  const numeric = typeof value === 'string' ? Number(value || 0) : value;
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  return `${safeValue.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  })} XLM`;
}

function ScreenHeader({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <View style={styles.back}>
        <Ionicons name="chevron-back" size={34} color={colors.ink} />
      </View>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: 50,
  },
  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.screenTitle,
    color: colors.ink,
  },
  headerSpacer: {
    width: 44,
  },
  keypadWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xxxl,
    minHeight: 360,
  },
});
