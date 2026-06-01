import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { ScannerHeader } from './ScannerHeader';
import { SmallDebugButton } from './SmallDebugButton';
import { AppButton } from '../ui/AppButton';
import { colors, shadows } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { radius } from '../../constants/radius';
import { typography } from '../../constants/typography';

export type ScannerPanelProps = {
  connectedPublicKey?: string;
  isLocked: boolean;
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
  onScanAgain: () => void;
  onUseDemoPayload: () => void;
  onClose?: () => void;
  onLogout?: () => void;
};

export function ScannerPanel({
  connectedPublicKey,
  isLocked,
  onBarcodeScanned,
  onScanAgain,
  onUseDemoPayload,
  onClose,
  onLogout,
}: ScannerPanelProps) {
  return (
    <View style={styles.scannerContent}>
      <ScannerHeader connectedPublicKey={connectedPublicKey} onLogout={onLogout} />

      <View style={styles.cameraFrame}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          active={!isLocked}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onBarcodeScanned}
        />
        <View pointerEvents="none" style={styles.cameraOverlay}>
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
        </View>
      </View>

      <Text style={styles.scanInstruction}>
        {isLocked ? 'Reading payment voucher...' : 'Align payment QR within frame'}
      </Text>

      <View style={styles.debugActions}>
        <AppButton
          title="Reset Scanner"
          onPress={onScanAgain}
          variant="light"
          icon={<Ionicons name="refresh-outline" size={16} color={colors.ink} />}
          style={styles.scanAgainButton}
        />
        {onClose && (
          <Pressable
            style={({ pressed }) => [styles.subtleCloseButton, pressed && styles.pressed]}
            onPress={onClose}
          >
            <Ionicons name="close" size={14} color={colors.muted} />
            <Text style={styles.subtleCloseText}>Close Camera</Text>
          </Pressable>
        )}
        <SmallDebugButton onPress={onUseDemoPayload} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scannerContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  cameraFrame: {
    width: '100%',
    maxWidth: 320,
    alignSelf: 'center',
    aspectRatio: 1,
    borderRadius: radius.xxl,
    overflow: 'hidden',
    ...shadows.card,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: colors.success,
  },
  cornerTopLeft: {
    top: spacing.lg,
    left: spacing.lg,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: radius.sm,
  },
  cornerTopRight: {
    top: spacing.lg,
    right: spacing.lg,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: radius.sm,
  },
  cornerBottomLeft: {
    bottom: spacing.lg,
    left: spacing.lg,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: radius.sm,
  },
  cornerBottomRight: {
    right: spacing.lg,
    bottom: spacing.lg,
    borderRightWidth: 5,
    borderBottomWidth: 5,
    borderBottomRightRadius: radius.sm,
  },
  scanInstruction: {
    ...typography.body,
    fontWeight: '700',
    color: colors.inkSoft,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  debugActions: {
    width: '100%',
    gap: spacing.md,
    marginTop: spacing.xxl,
  },
  scanAgainButton: {
    borderRadius: radius.xl,
  },
  subtleCloseButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  subtleCloseText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
});
