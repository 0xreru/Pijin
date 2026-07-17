/**
 * Pijin-branded deposit action.
 *
 * PHPC trustline creation belongs to account onboarding. This button only
 * starts the SEP-24 deposit flow.
 */

import React, { useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PIJIN_ASSETS, type AssetCode } from '../../services/stellar/trustlineService';

interface DepositButtonProps {
  /** Which Pijin asset this button deposits. */
  assetCode: AssetCode;
  /** Starts the SEP-24 deposit flow. */
  onPress: (assetCode: AssetCode) => void;
  /** Optional custom button label. Defaults to "Deposit [ASSET]". */
  label?: string;
  /** Pass-through disabled state (for example while offline or loading). */
  disabled?: boolean;
}

export function DepositButton({
  assetCode,
  onPress,
  label,
  disabled = false,
}: DepositButtonProps) {
  const pressScale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () =>
    Animated.spring(pressScale, {
      toValue: 0.92,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();

  const handlePressOut = () =>
    Animated.spring(pressScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();

  return (
    <View style={styles.actionItem}>
      <Animated.View style={{ transform: [{ scale: pressScale }] }}>
        <TouchableOpacity
          style={[styles.actionCircle, disabled && styles.actionCircleDisabled]}
          onPress={() => onPress(assetCode)}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={1}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Deposit ${assetCode}`}
          accessibilityHint={`Tap to deposit ${PIJIN_ASSETS[assetCode].code} to your Pijin wallet`}
        >
          <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>
      <Text style={styles.actionLabel}>{label ?? `Deposit ${assetCode}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionItem: {
    alignItems: 'center',
    flex: 1,
  },
  actionCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#001E42',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#001E42',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  actionCircleDisabled: {
    opacity: 0.4,
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#001E42',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 2,
  },
});
