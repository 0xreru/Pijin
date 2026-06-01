import React, { useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusPanel } from './StatusPanel';
import { ActionStack } from './ActionStack';
import { AppButton } from '../ui/AppButton';
import { OfflinePaymentPayload } from '../../types/payment';
import { SMS_GATEWAY_NUMBER } from '../../constants/api';
import { simulateSmsSettlement } from '../../services/api/settlement';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { radius } from '../../constants/radius';
import { typography } from '../../constants/typography';

export type SmsPreparedPanelProps = {
  payload: OfflinePaymentPayload;
  onScanAnother: () => void;
  onBackToDashboard?: () => void;
  onViewHistory?: () => void;
};

export function SmsPreparedPanel({
  payload,
  onScanAnother,
  onBackToDashboard,
  onViewHistory,
}: SmsPreparedPanelProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function openSmsApp() {
    const body = encodeURIComponent(payload.smsBody);
    const phone = SMS_GATEWAY_NUMBER.trim();
    // iOS deep link syntax uses '&', Android uses '?'
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const smsUrl = phone
      ? `sms:${phone}${separator}body=${body}`
      : `sms:${separator}body=${body}`;

    try {
      await Linking.openURL(smsUrl);
      setStatus('SMS app opened. Send message to reach gateway.');
    } catch (error) {
      console.error('[sms-prepared-panel] failed to launch SMS app:', error);
      setStatus('Unable to open SMS app. Copy SMS payload below and send manually.');
    }
  }

  async function simulateSettlement() {
    setIsSubmitting(true);
    setStatus(null);
    try {
      const result = await simulateSmsSettlement(payload.smsBody);
      setStatus(result.message + (result.txHash ? ` Tx: ${result.txHash.slice(0, 8)}...` : ''));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Simulation failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <StatusPanel icon="chatbubble-ellipses" title="SMS verification prepared">
      <Text style={styles.panelText}>Send this exact body to the SMS gateway (or simulate via API in dev).</Text>

      <View style={styles.smsBodyBox}>
        <Text style={styles.smsBodyLabel}>SMS PAYLOAD</Text>
        <Text style={styles.smsBodyText} selectable>
          {payload.smsBody}
        </Text>
      </View>

      {status ? <Text style={styles.statusMessageText}>{status}</Text> : null}

      <AppButton
        title="Open SMS App"
        onPress={openSmsApp}
        variant="primary"
        icon={<Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.surface} />}
        style={{ marginTop: spacing.xl }}
      />

      <AppButton
        title={isSubmitting ? 'Submitting...' : 'Dev: Simulate settlement API'}
        onPress={simulateSettlement}
        variant="outline"
        disabled={isSubmitting}
        style={{ marginTop: spacing.md }}
      />

      <ActionStack
        onScanAnother={onScanAnother}
        onBackToDashboard={onBackToDashboard}
        onViewHistory={onViewHistory}
      />
    </StatusPanel>
  );
}

const styles = StyleSheet.create({
  panelText: {
    ...typography.body,
    fontSize: 14,
    color: colors.mutedDark,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  smsBodyBox: {
    width: '100%',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  smsBodyLabel: {
    color: colors.muted,
    fontWeight: '900',
    fontSize: 9,
    letterSpacing: 1.2,
  },
  smsBodyText: {
    color: colors.ink,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  statusMessageText: {
    ...typography.caption,
    color: colors.inkSoft,
    textAlign: 'center',
    marginTop: spacing.md,
    fontWeight: '700',
  },
});
