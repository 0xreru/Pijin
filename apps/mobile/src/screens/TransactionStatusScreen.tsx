import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { ReceiptCard } from '../components/transaction/ReceiptCard';
import { AppButton } from '../components/ui/AppButton';
import { ScreenContainer } from '../components/ui/ScreenContainer';
import { spacing } from '../constants/spacing';
import { colors } from '../constants/theme';
import { typography } from '../constants/typography';
import { SettlementStep } from '../types/transaction';

const steps: SettlementStep[] = [
  { label: 'Verified Offline', status: 'done' },
  { label: 'Pending Settlement', status: 'active' },
  { label: 'Settled', status: 'pending' },
];

export function TransactionStatusScreen() {
  return (
    <ScreenContainer backgroundColor={colors.backgroundSoft} contentStyle={styles.screen}>
      <View style={styles.header}>
        <View style={styles.back}>
          <Ionicons name="chevron-back" size={34} color={colors.ink} />
        </View>
        <Text style={styles.headerTitle}>Payment Status</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.receiptScene}>
        <View style={styles.receiptBar} />
        <ReceiptCard amount={500} payer="Erickson" date="Oct 24, 2025" refId="#TX-994A-2IB" steps={steps} />
      </View>

      <AppButton
        title="DOWNLOAD"
        variant="light"
        icon={<Ionicons name="download-outline" size={20} color={colors.ink} />}
        style={styles.downloadButton}
      />

      <View style={styles.bottomPanel}>
        <View style={styles.networkRow}>
          <Text style={styles.networkLabel}>Network</Text>
          <View style={styles.networkValueWrap}>
            <Text style={styles.networkValue}>Stellar Network</Text>
            <View style={styles.networkDot} />
          </View>
        </View>
        <AppButton title="Settle on Stellar" style={styles.settleButton} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: 61,
    paddingHorizontal: spacing.xxl,
    paddingBottom: 0,
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
  receiptScene: {
    marginTop: 80,
    alignItems: 'center',
  },
  receiptBar: {
    position: 'absolute',
    top: -24,
    left: spacing.md,
    right: spacing.md,
    height: 58,
    borderRadius: 14,
    backgroundColor: '#202020',
  },
  downloadButton: {
    alignSelf: 'center',
    width: '86%',
    marginTop: 54,
    borderWidth: 1,
    borderColor: '#DADADA',
  },
  bottomPanel: {
    marginHorizontal: -spacing.xxl,
    marginTop: 52,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    backgroundColor: colors.background,
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  networkLabel: {
    ...typography.body,
    color: colors.muted,
    fontSize: 19,
  },
  networkValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  networkValue: {
    ...typography.body,
    color: colors.muted,
    fontSize: 19,
  },
  networkDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  settleButton: {
    minHeight: 53,
  },
});
