import { useRef, useState } from 'react';
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import * as SMS from 'expo-sms';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { typography } from '../../constants/typography';
import { SMS_GATEWAY_NUMBER } from '../../constants/api';

type MerchantPosScannerProps = {
  gatewayNumber?: string;
};

export function MerchantPosScanner({ gatewayNumber }: MerchantPosScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const scannerLockRef = useRef(false);

  const hasCameraPermission = permission?.granted === true;
  const canScan = hasCameraPermission && !isLocked;

  async function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (scannerLockRef.current || !canScan) {
      return;
    }
    if (result.type !== 'qr') {
      return;
    }

    scannerLockRef.current = true;
    setIsLocked(true);
    await openSmsComposer(result.data);
  }

  async function openSmsComposer(payload: string) {
    const isAvailable = await SMS.isAvailableAsync();
    if (!isAvailable) {
      setStatus('SMS not available on this device.');
      return;
    }

    const destination = gatewayNumber?.trim() || SMS_GATEWAY_NUMBER || '+639XX...';
    const result = await SMS.sendSMSAsync([destination], payload);

    if (result.result === 'sent') {
      setStatus('SMS sent.');
      return;
    }
    if (result.result === 'cancelled') {
      setStatus('SMS cancelled.');
      return;
    }
    setStatus('SMS result unknown.');
  }

  function handleScanAgain() {
    scannerLockRef.current = false;
    setIsLocked(false);
    setStatus(null);
  }

  if (!hasCameraPermission) {
    return (
      <View style={styles.panel}>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.body}>Allow camera access to scan payment QR codes.</Text>
        <Pressable style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]} onPress={requestPermission}>
          <Text style={styles.primaryActionText}>Allow Camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Merchant POS Scanner</Text>
      <Text style={styles.body}>Scan customer QR to open SMS to gateway.</Text>

      <View style={styles.cameraFrame}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          active={!isLocked}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleBarcodeScanned}
        />
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Pressable style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]} onPress={handleScanAgain}>
        <Text style={styles.secondaryActionText}>Scan Again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.xxl,
    gap: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.ink,
    fontSize: 22,
  },
  body: {
    ...typography.body,
    color: colors.muted,
  },
  cameraFrame: {
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  status: {
    ...typography.caption,
    color: colors.mutedDark,
  },
  primaryAction: {
    backgroundColor: colors.ink,
    paddingVertical: spacing.md,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryActionText: {
    color: colors.surface,
    fontWeight: '700',
  },
  secondaryAction: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryActionText: {
    color: colors.ink,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
});
