import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScannerHeader } from './ScannerHeader';
import { SmallDebugButton } from './SmallDebugButton';
import { AppCard } from '../ui/AppCard';
import { AppButton } from '../ui/AppButton';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { radius } from '../../constants/radius';

export type PermissionPanelProps = {
  connectedPublicKey?: string;
  onRequestPermission: () => void;
  onUseDemoPayload: () => void;
  onClose?: () => void;
  onLogout?: () => void;
};

export function PermissionPanel({
  connectedPublicKey,
  onRequestPermission,
  onUseDemoPayload,
  onClose,
  onLogout,
}: PermissionPanelProps) {
  return (
    <View style={styles.scannerContent}>
      <ScannerHeader connectedPublicKey={connectedPublicKey} onLogout={onLogout} />

      <AppCard bordered style={styles.permissionCard}>
        <View style={styles.statusIconContainer}>
          <Ionicons name="camera-outline" size={28} color={colors.ink} />
        </View>
        <Text style={styles.statusPanelTitle}>Camera access needed</Text>
        <Text style={styles.panelText}>Allow camera access to scan customer payment QR codes.</Text>

        <AppButton
          title="Allow Camera"
          onPress={onRequestPermission}
          variant="primary"
          icon={<Ionicons name="camera-outline" size={18} color={colors.surface} />}
          style={styles.panelButton}
        />
        {onClose && (
          <Pressable
            style={({ pressed }) => [styles.subtleCloseButton, pressed && styles.pressed]}
            onPress={onClose}
          >
            <Text style={styles.subtleCloseText}>Cancel</Text>
          </Pressable>
        )}
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
