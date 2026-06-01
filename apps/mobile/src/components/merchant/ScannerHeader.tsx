import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../constants/theme';
import { spacing } from '../../constants/spacing';
import { radius } from '../../constants/radius';
import { typography } from '../../constants/typography';
import { shadows } from '../../constants/theme';

export type ScannerHeaderProps = {
  connectedPublicKey?: string;
  onLogout?: () => void;
};

export function ScannerHeader({ connectedPublicKey, onLogout }: ScannerHeaderProps) {
  function shortenPublicKey(key: string) {
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={styles.headerAvatarContainer}>
          <Ionicons name="qr-code" size={24} color={colors.ink} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Scan Payment QR</Text>
          {connectedPublicKey ? (
            <View style={styles.keyPill}>
              <Ionicons name="wallet-outline" size={10} color={colors.muted} />
              <Text style={styles.keyPillText}>{shortenPublicKey(connectedPublicKey)}</Text>
            </View>
          ) : (
            <View style={[styles.keyPill, styles.keyPillDisconnected]}>
              <Ionicons name="warning-outline" size={10} color={colors.danger} />
              <Text style={[styles.keyPillText, { color: colors.danger }]}>No merchant wallet</Text>
            </View>
          )}
        </View>
      </View>
      {onLogout && (
        <Pressable
          style={({ pressed }) => [styles.headerLogoutButton, pressed && styles.pressed]}
          onPress={onLogout}
        >
          <Ionicons name="log-out-outline" size={20} color={colors.surface} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xxl,
    width: '100%',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  headerAvatarContainer: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  headerCopy: {
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.title,
    fontSize: 22,
    lineHeight: 26,
    color: colors.ink,
    fontWeight: '900',
  },
  keyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyPillDisconnected: {
    borderColor: 'rgba(240, 68, 56, 0.2)',
    backgroundColor: 'rgba(240, 68, 56, 0.04)',
  },
  keyPillText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
  },
  headerLogoutButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
});
