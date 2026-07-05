/**
 * DepositButton.tsx
 *
 * Pijin-branded "Deposit" button with a built-in JIT Trustline overlay.
 *
 * Usage
 * ─────
 * ```tsx
 * <DepositButton
 *   assetCode="PHPC"
 *   publicKey={connectedWalletPublicKey}
 *   onSuccess={(code) => openSep24Webview(code)}
 * />
 * ```
 *
 * What happens on press
 * ─────────────────────
 * 1. Silently checks the user's balances for an existing trustline.
 * 2. If the trustline exists → `onSuccess` fires immediately.
 * 3. If missing → a full-screen Pijin-branded overlay appears while the
 *    ChangeTrust tx is built, signed, and submitted to Horizon Testnet.
 * 4. On success → overlay dismisses, `onSuccess` fires.
 * 5. On failure → overlay switches to a clean error card with a "Retry" CTA.
 */

import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AssetCode, PIJIN_ASSETS } from '../../services/stellar/trustlineService';
import { useJitTrustline } from '../../hooks/useJitTrustline';

// ─── Public component props ───────────────────────────────────────────────────

interface DepositButtonProps {
  /** Which Pijin asset this button deposits. */
  assetCode: AssetCode;
  /** The user's Stellar public key (from AuthContext). */
  publicKey: string | null | undefined;
  /** Fired when the trustline is confirmed and the SEP-24 webview should open. */
  onSuccess: (assetCode: AssetCode) => void;
  /** Optional custom button label. Defaults to "Deposit [ASSET]". */
  label?: string;
  /** Pass-through disabled state (e.g. when offline). */
  disabled?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DepositButton({
  assetCode,
  publicKey,
  onSuccess,
  label,
  disabled = false,
}: DepositButtonProps) {
  const { phase, activeAsset, errorMessage, handleDepositClick, dismissError } =
    useJitTrustline({ onSuccess, publicKey });

  const overlayVisible =
    (phase === 'checking' || phase === 'establishing' || phase === 'error') &&
    activeAsset === assetCode;

  const isLoading = phase === 'checking' || phase === 'establishing';

  return (
    <>
      {/* ── Deposit CTA ── */}
      <TouchableOpacity
        style={[
          styles.button,
          (disabled || isLoading) && styles.buttonDisabled,
        ]}
        onPress={() => handleDepositClick(assetCode)}
        activeOpacity={0.82}
        disabled={disabled || isLoading}
        accessibilityRole="button"
        accessibilityLabel={`Deposit ${assetCode}`}
        accessibilityHint={`Tap to deposit ${PIJIN_ASSETS[assetCode].code} to your Pijin wallet`}
      >
        <View style={styles.buttonContent}>
          {phase === 'checking' && activeAsset === assetCode ? (
            <>
              <ActivityIndicator
                size="small"
                color="#fff"
                style={styles.buttonSpinner}
              />
              <Text style={styles.buttonText}>Checking…</Text>
            </>
          ) : (
            <Text style={styles.buttonText}>{label ?? `Deposit ${assetCode}`}</Text>
          )}
        </View>
      </TouchableOpacity>

      {/* ── JIT Overlay Modal ── */}
      <Modal
        visible={overlayVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={phase === 'error' ? dismissError : undefined}
      >
        <View style={styles.backdrop}>
          {phase === 'error' ? (
            <ErrorCard assetCode={assetCode} message={errorMessage} onDismiss={dismissError} />
          ) : (
            <LoadingCard assetCode={assetCode} phase={phase} />
          )}
        </View>
      </Modal>
    </>
  );
}

// ─── Loading Card ─────────────────────────────────────────────────────────────

interface LoadingCardProps {
  assetCode: AssetCode;
  phase: 'checking' | 'establishing';
}

function LoadingCard({ assetCode, phase }: LoadingCardProps) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.9)).current;

  // Infinite rotation for the ring spinner.
  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    // Gentle pulse for the card itself.
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.96,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    spin.start();
    pulse.start();
    return () => {
      spin.stop();
      pulse.stop();
    };
  }, [spinAnim, pulseAnim]);

  const rotate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const headingText =
    phase === 'establishing'
      ? `Setting up secure vault\nfor ${assetCode}…`
      : `Preparing your wallet\nfor ${assetCode}…`;

  const subText =
    phase === 'establishing'
      ? 'Signing & submitting to Stellar Testnet'
      : 'Checking your balances';

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: pulseAnim }] }]}>
      {/* Decorative gradient blobs */}
      <View style={styles.blob1} />
      <View style={styles.blob2} />

      {/* Wordmark */}
      <Text style={styles.wordmark}>pijin</Text>

      {/* Spinner */}
      <View style={styles.spinnerWrapper}>
        <Animated.View
          style={[styles.spinnerRing, { transform: [{ rotate }] }]}
        />
        <View style={styles.spinnerInner}>
          <Text style={styles.spinnerIcon}>⬡</Text>
        </View>
      </View>

      {/* Copy */}
      <Text style={styles.heading}>{headingText}</Text>
      <Text style={styles.subText}>{subText}</Text>

      {/* Asset pill */}
      <View style={styles.assetPill}>
        <View style={styles.assetDot} />
        <Text style={styles.assetPillText}>{PIJIN_ASSETS[assetCode].code}</Text>
      </View>
    </Animated.View>
  );
}

// ─── Error Card ───────────────────────────────────────────────────────────────

interface ErrorCardProps {
  assetCode: AssetCode;
  message: string | null;
  onDismiss: () => void;
}

function ErrorCard({ assetCode, message, onDismiss }: ErrorCardProps) {
  return (
    <View style={[styles.card, styles.cardError]}>
      <View style={styles.blob2} />

      {/* Wordmark */}
      <Text style={styles.wordmark}>pijin</Text>

      {/* Error icon */}
      <View style={styles.errorIconWrapper}>
        <Text style={styles.errorIconText}>✕</Text>
      </View>

      <Text style={styles.heading}>Setup Failed</Text>
      <Text style={styles.subText}>
        {message ?? `We could not create a ${assetCode} trustline. Please try again.`}
      </Text>

      {/* Dismiss / Retry CTA */}
      <TouchableOpacity style={styles.retryBtn} onPress={onDismiss} activeOpacity={0.82}>
        <Text style={styles.retryBtnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const PIJIN_DEEP_NAVY = '#001233';
const PIJIN_NAVY = '#002855';
const PIJIN_BLUE = '#2D557E';
const PIJIN_ACCENT = '#4A90D9';
const PIJIN_WHITE = '#FFFFFF';
const PIJIN_WHITE_60 = 'rgba(255,255,255,0.60)';
const PIJIN_WHITE_15 = 'rgba(255,255,255,0.15)';
const PIJIN_WHITE_08 = 'rgba(255,255,255,0.08)';
const PIJIN_ERROR = '#FF4B6A';

const styles = StyleSheet.create({
  // ── Button ──────────────────────────────────────────────────────────────
  button: {
    backgroundColor: PIJIN_NAVY,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: PIJIN_DEEP_NAVY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonSpinner: {
    // Keeps the spinner tightly aligned next to the label
  },
  buttonText: {
    color: PIJIN_WHITE,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── Backdrop ─────────────────────────────────────────────────────────────
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 18, 51, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  // ── Shared card ──────────────────────────────────────────────────────────
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: PIJIN_NAVY,
    borderRadius: 28,
    padding: 36,
    alignItems: 'center',
    overflow: 'hidden',
    // Subtle inner border
    borderWidth: 1,
    borderColor: PIJIN_WHITE_15,
    // Drop shadow
    shadowColor: PIJIN_DEEP_NAVY,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.6,
    shadowRadius: 40,
    elevation: 24,
  },
  cardError: {
    borderColor: 'rgba(255, 75, 106, 0.30)',
  },

  // ── Decorative blobs (non-interactive background glows) ──────────────────
  blob1: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: PIJIN_BLUE,
    opacity: 0.25,
    top: -80,
    right: -60,
  },
  blob2: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: PIJIN_ACCENT,
    opacity: 0.12,
    bottom: -60,
    left: -40,
  },

  // ── Wordmark ─────────────────────────────────────────────────────────────
  wordmark: {
    color: PIJIN_WHITE_60,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 6,
    textTransform: 'uppercase',
    marginBottom: 32,
  },

  // ── Spinner ──────────────────────────────────────────────────────────────
  spinnerWrapper: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  spinnerRing: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2.5,
    // Dashed appearance via transparent segments
    borderColor: PIJIN_ACCENT,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
  },
  spinnerInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: PIJIN_WHITE_08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerIcon: {
    fontSize: 22,
    color: PIJIN_ACCENT,
  },

  // ── Copy ─────────────────────────────────────────────────────────────────
  heading: {
    color: PIJIN_WHITE,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: 10,
  },
  subText: {
    color: PIJIN_WHITE_60,
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    paddingHorizontal: 8,
  },

  // ── Asset pill ───────────────────────────────────────────────────────────
  assetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PIJIN_WHITE_08,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: PIJIN_WHITE_15,
    gap: 8,
  },
  assetDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PIJIN_ACCENT,
  },
  assetPillText: {
    color: PIJIN_WHITE,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  // ── Error icon ───────────────────────────────────────────────────────────
  errorIconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 75, 106, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 75, 106, 0.40)',
  },
  errorIconText: {
    color: PIJIN_ERROR,
    fontSize: 22,
    fontWeight: '700',
  },

  // ── Retry button ─────────────────────────────────────────────────────────
  retryBtn: {
    backgroundColor: PIJIN_ACCENT,
    paddingVertical: 13,
    paddingHorizontal: 36,
    borderRadius: 12,
    alignItems: 'center',
  },
  retryBtnText: {
    color: PIJIN_WHITE,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
