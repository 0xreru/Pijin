import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScannerHeader } from './ScannerHeader';
import { SmallDebugButton } from './SmallDebugButton';
import { AppCard } from '../ui/AppCard';
import { AppButton } from '../ui/AppButton';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { radius } from '../../constants/radius';

export type IdlePanelProps = {
  connectedPublicKey?: string;
  onStartScanner: () => void;
  onUseDemoPayload: () => void;
  onLogout?: () => void;
};

export function IdlePanel({
  connectedPublicKey,
  onStartScanner,
  onUseDemoPayload,
  onLogout,
}: IdlePanelProps) {
  return (
    <View style={styles.scannerContent}>
      <ScannerHeader connectedPublicKey={connectedPublicKey} onLogout={onLogout} />

      <AppCard bordered style={styles.permissionCard}>
        <View style={styles.statusIconContainer}>
          <Ionicons name="camera-reverse-outline" size={28} color={colors.ink} />
        </View>
        <Text style={styles.statusPanelTitle}>Scanner Inactive</Text>
        <Text style={styles.panelText}>
          Tap the button below to activate the camera viewfinder and scan customer payment QR codes.
        </Text>

        <AppButton
          title="Open Camera"
          onPress={onStartScanner}
          variant="primary"
          icon={<Ionicons name="scan-outline" size={18} color={colors.surface} />}
          style={styles.panelButton}
        />
      </AppCard>

      <SmallDebugButton onPress={onUseDemoPayload} />
    </View>
  );
}

const styles = StyleSheet.create({
  scannerContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  permissionCard: {
    width: '100%',
    padding: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  statusIconContainer: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    backgroundColor: 'rgba(8, 9, 10, 0.05)',
  },
  statusPanelTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.ink,
    textAlign: 'center',
  },
  panelText: {
    fontSize: 14,
    color: colors.mutedDark,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  panelButton: {
    width: '100%',
    marginTop: spacing.xl,
    borderRadius: radius.xl,
  },
});
