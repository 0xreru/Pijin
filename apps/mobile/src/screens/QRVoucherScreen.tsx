import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { ScreenContainer } from '../components/ui/ScreenContainer';
import { spacing } from '../constants/spacing';
import { colors, shadows } from '../constants/theme';
import { getDefaultMerchantShortId } from '../services/api/merchants';
import { buildOfflineSmsVoucher } from '../services/offline/buildSmsPayload';
import { buildQrJsonFromVoucher } from '../utils/offlinePaymentPayload';
import type { OfflinePaymentPayload } from '../types/payment';

type QRVoucherScreenProps = {
  amount: number;
  customerPublicKey?: string;
  customerShortId?: string;
  merchantShortId?: string;
  onCancel?: () => void;
};

const PESO = '✦';

export function QRVoucherScreen({
  amount,
  customerPublicKey,
  customerShortId,
  merchantShortId,
  onCancel,
}: QRVoucherScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [resolvedMerchantShortId, setResolvedMerchantShortId] = useState<string | null>(merchantShortId ?? null);
  const [voucher, setVoucher] = useState<
    | { payload: OfflinePaymentPayload; qrValue: string; smsPreview: string }
    | null
  >(null);

  useEffect(() => {
    if (merchantShortId) {
      setResolvedMerchantShortId(merchantShortId);
      return;
    }

    let isActive = true;
    getDefaultMerchantShortId()
      .then((shortId) => {
        if (isActive) {
          setResolvedMerchantShortId(shortId);
        }
      })
      .catch(() => {
        if (isActive) {
          setResolvedMerchantShortId(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [merchantShortId]);

  useEffect(() => {
    let isActive = true;

    async function buildVoucher() {
      if (!customerShortId) {
        setError('Register with the backend first to get a customer short ID (C-xxxx).');
        setVoucher(null);
        return;
      }
      if (!resolvedMerchantShortId) {
        setError('No merchant short ID found in backend database.');
        setVoucher(null);
        return;
      }

      try {
        setError(null);
        const built = await buildOfflineSmsVoucher({
          customerShortId,
          merchantShortId: resolvedMerchantShortId,
          amountPhp: amount,
        });

        const payload: OfflinePaymentPayload = {
          type: 'ABOTPERA_OFFLINE_PAYMENT',
          version: 2,
          amount,
          currency: 'PHP',
          customerShortId,
          merchantShortId: resolvedMerchantShortId,
          customerPublicKey,
          smsBody: built.smsBody,
          createdAt: new Date().toISOString(),
          expiresInMinutes: 10,
        };

        if (!isActive) {
          return;
        }

        setVoucher({
          payload,
          qrValue: buildQrJsonFromVoucher(payload),
          smsPreview: built.smsBody,
        });
      } catch (err) {
        if (!isActive) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Unable to build payment voucher.');
        setVoucher(null);
      }
    }

    buildVoucher();

    return () => {
      isActive = false;
    };
  }, [amount, customerPublicKey, customerShortId, resolvedMerchantShortId]);

  return (
    <ScreenContainer scroll={false} backgroundColor={colors.surface} contentStyle={styles.screen}>
      <View style={styles.root}>
        <Text style={styles.title}>Payment Voucher</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {voucher ? (
          <>
            <View style={styles.cardShadow}>
              <View style={styles.cardHandle} />
              <View style={styles.card}>
                <View style={styles.qrFrame}>
                  <QRCode
                    value={voucher.qrValue}
                    size={142}
                    backgroundColor={colors.surface}
                    color={colors.primary}
                  />
                </View>

                <Text style={styles.label}>AMOUNT TO PAY</Text>
                <Text style={styles.amountText}>
                  {PESO}
                  {formatAmount(amount)}
                </Text>

                <View style={styles.divider} />
                <Text style={styles.instruction}>SHOW THIS CODE TO THE MERCHANT.</Text>
                <Text style={styles.shortId}>Your ID: {customerShortId}</Text>
              </View>
            </View>

            <View style={styles.smsPreview}>
              <Text style={styles.smsLabel}>Settlement SMS (merchant sends to gateway)</Text>
              <Text style={styles.smsBody} selectable>
                {voucher.smsPreview}
              </Text>
            </View>
          </>
        ) : null}

        <Pressable style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} onPress={onCancel}>
          <Text style={styles.cancelText}>CANCEL AND GO BACK</Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}

function formatAmount(amount: number) {
  return amount.toLocaleString('en-PH', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 76,
    paddingBottom: 0,
  },
  root: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: 92,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: spacing.lg,
  },
  error: {
    color: colors.notification,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  cardShadow: {
    width: '100%',
    maxWidth: 320,
    ...shadows.card,
  },
  cardHandle: {
    alignSelf: 'center',
    width: 48,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  qrFrame: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 1,
  },
  amountText: {
    fontSize: 36,
    fontWeight: '900',
    color: colors.primary,
    marginTop: spacing.xs,
  },
  divider: {
    width: '80%',
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  instruction: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textAlign: 'center',
  },
  shortId: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  smsPreview: {
    marginTop: spacing.xl,
    width: '100%',
    maxWidth: 320,
    padding: spacing.md,
    backgroundColor: colors.backgroundSoft,
    borderRadius: 8,
  },
  smsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  smsBody: {
    fontSize: 11,
    color: colors.ink,
    fontFamily: 'monospace',
  },
  cancelButton: {
    marginTop: 'auto',
    paddingVertical: spacing.lg,
  },
  pressed: {
    opacity: 0.85,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.5,
  },
});
