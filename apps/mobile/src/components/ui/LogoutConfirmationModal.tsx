import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, shadows } from '../../constants/theme';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { typography } from '../../constants/typography';

type LogoutConfirmationModalProps = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function LogoutConfirmationModal({ visible, onCancel, onConfirm }: LogoutConfirmationModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalIconContainer}>
            <Ionicons name="log-out-outline" size={28} color={colors.danger} />
          </View>
          <Text style={styles.modalTitle}>Log Out of Account?</Text>
          <Text style={styles.modalMessage}>
            Are you sure you want to log out of your merchant dashboard? You will need to sign back in to access your transactions.
          </Text>
          <View style={styles.modalActions}>
            <Pressable
              style={({ pressed }) => [
                styles.modalButton,
                styles.modalButtonCancel,
                pressed && styles.pressed,
              ]}
              onPress={onCancel}
            >
              <Text style={styles.modalButtonCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.modalButton,
                styles.modalButtonConfirm,
                pressed && styles.pressed,
              ]}
              onPress={onConfirm}
            >
              <Text style={styles.modalButtonConfirmText}>Log Out</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 9, 10, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadows.card,
  },
  modalIconContainer: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(240, 68, 56, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    ...typography.title,
    fontSize: 20,
    fontWeight: '900',
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  modalMessage: {
    ...typography.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonCancel: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  modalButtonCancelText: {
    color: colors.mutedDark,
    fontSize: 14,
    fontWeight: '700',
  },
  modalButtonConfirm: {
    backgroundColor: colors.danger,
  },
  modalButtonConfirmText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
});
