/**
 * DepositButton.tsx
 *
 * Pijin-branded "Deposit" button with a built-in JIT Trustline overlay.
 * Redesigned to match the app's overall theme:
 *  - White surface cards, deep navy (#031634 / #001E42) accents
 *  - expo-linear-gradient for branded elements
 *  - Native Animated API for smooth, 60fps animations
 *  - Consistent with BalanceCard, AppButton, DashboardHeader design language
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
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AssetCode, PIJIN_ASSETS } from '../../services/stellar/trustlineService';
import { useJitTrustline } from '../../hooks/useJitTrustline';

// ─── Theme tokens (mirrors app-wide theme.ts + BalanceCard colors) ────────────

const T = {
  navyDark: '#02132B',
  navy: '#031634',
  navyMid: '#04224C',
  navyAccent: '#001E42',
  accent: '#635BFF',       // walletPurple from theme.ts
  accentLight: '#8B87FF',
  success: '#16C784',      // theme.ts success
  danger: '#F04438',       // theme.ts danger
  surface: '#FFFFFF',
  surfaceSoft: '#F5F5F6',
  surfaceMuted: '#F0F0F0',
  border: '#DADADA',
  borderSoft: '#E6E9EE',
  ink: '#08090A',
  inkSoft: '#3F4144',
  muted: '#707984',
  shadowNavy: '#031634',
  // Overlay tokens
  overlayBg: 'rgba(2, 19, 43, 0.92)',
  white: '#FFFFFF',
  white80: 'rgba(255,255,255,0.80)',
  white50: 'rgba(255,255,255,0.50)',
  white20: 'rgba(255,255,255,0.20)',
  white10: 'rgba(255,255,255,0.10)',
  white06: 'rgba(255,255,255,0.06)',
};

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

  // Subtle scale press animation for the CTA circle
  const pressScale = useRef(new Animated.Value(1)).current;
  const handlePressIn = () =>
    Animated.spring(pressScale, { toValue: 0.92, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const handlePressOut = () =>
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();

  return (
    <>
      {/* ── Deposit CTA (circle + label, matching action row siblings) ── */}
      <View style={styles.actionItem}>
        <Animated.View style={{ transform: [{ scale: pressScale }] }}>
          <TouchableOpacity
            style={[
              styles.actionCircle,
              (disabled || isLoading) && styles.actionCircleDisabled,
            ]}
            onPress={() => handleDepositClick(assetCode)}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            activeOpacity={1}
            disabled={disabled || isLoading}
            accessibilityRole="button"
            accessibilityLabel={`Deposit ${assetCode}`}
            accessibilityHint={`Tap to deposit ${PIJIN_ASSETS[assetCode].code} to your Pijin wallet`}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </Animated.View>
        <Text style={styles.actionLabel}>{label ?? `Deposit ${assetCode}`}</Text>
      </View>

      {/* ── JIT Overlay Modal ── */}
      <Modal
        visible={overlayVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={phase === 'error' ? dismissError : undefined}
      >
        <OverlayContent>
          {phase === 'error' ? (
            <ErrorCard assetCode={assetCode} message={errorMessage} onDismiss={dismissError} />
          ) : (
            <LoadingCard assetCode={assetCode} phase={phase} />
          )}
        </OverlayContent>
      </Modal>
    </>
  );
}

// ─── Overlay Wrapper (animated backdrop) ──────────────────────────────────────

function OverlayContent({ children }: { children: React.ReactNode }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const slideY = fadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [40, 0],
  });

  return (
    <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
      <Animated.View style={{ transform: [{ translateY: slideY }], width: '100%', alignItems: 'center' }}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

// ─── Loading Card ─────────────────────────────────────────────────────────────

interface LoadingCardProps {
  assetCode: AssetCode;
  phase: 'checking' | 'establishing';
}

function LoadingCard({ assetCode, phase }: LoadingCardProps) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const dotAnim1 = useRef(new Animated.Value(0.3)).current;
  const dotAnim2 = useRef(new Animated.Value(0.3)).current;
  const dotAnim3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    // Spinner rotation
    const spin = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    // Gentle card pulse
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.012, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.988, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );

    // Staggered dot animation
    const makeDot = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 380, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0.3, duration: 380, easing: Easing.in(Easing.ease), useNativeDriver: true }),
          Animated.delay(760 - delay),
        ]),
      );

    spin.start();
    pulse.start();
    makeDot(dotAnim1, 0).start();
    makeDot(dotAnim2, 180).start();
    makeDot(dotAnim3, 360).start();

    return () => {
      spin.stop();
      pulse.stop();
      dotAnim1.stopAnimation();
      dotAnim2.stopAnimation();
      dotAnim3.stopAnimation();
    };
  }, [spinAnim, pulseAnim, dotAnim1, dotAnim2, dotAnim3]);

  const rotate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const headingText =
    phase === 'establishing'
      ? `Setting up your\n${assetCode} vault`
      : `Checking your\nwallet`;

  const subText =
    phase === 'establishing'
      ? 'Signing & submitting to Stellar Network'
      : `Verifying ${assetCode} trustline…`;

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: pulseAnim }] }]}>
      {/* Gradient header strip */}
      <LinearGradient
        colors={[T.navyDark, T.navyMid]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cardHeader}
      >
        {/* Decorative dot */}
        <View style={styles.headerDot} />
        <View style={styles.headerDotSm} />

        {/* App wordmark */}
        <Text style={styles.wordmark}>PIJIN</Text>

        {/* Asset pill inside header */}
        <View style={styles.headerPill}>
          <View style={styles.pillDot} />
          <Text style={styles.headerPillText}>{PIJIN_ASSETS[assetCode].code}</Text>
        </View>
      </LinearGradient>

      {/* Card body */}
      <View style={styles.cardBody}>
        {/* Animated spinner */}
        <View style={styles.spinnerWrapper}>
          <Animated.View style={[styles.spinnerRing, { transform: [{ rotate }] }]} />
          {/* Inner circle with navy background */}
          <View style={styles.spinnerInner}>
            <Ionicons name="shield-checkmark" size={22} color={T.navyAccent} />
          </View>
        </View>

        {/* Copy */}
        <Text style={styles.cardHeading}>{headingText}</Text>
        <Text style={styles.cardSubText}>{subText}</Text>

        {/* Animated dots progress indicator */}
        <View style={styles.dotsRow}>
          {[dotAnim1, dotAnim2, dotAnim3].map((anim, i) => (
            <Animated.View key={i} style={[styles.dot, { opacity: anim }]} />
          ))}
        </View>
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
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  return (
    <Animated.View style={[styles.card, { transform: [{ translateX: shakeAnim }] }]}>
      {/* Gradient header — danger tint */}
      <LinearGradient
        colors={['#2D0A0A', '#4A1010']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cardHeader}
      >
        <View style={styles.headerDot} />
        <Text style={styles.wordmark}>PIJIN</Text>
        <View style={[styles.headerPill, styles.headerPillDanger]}>
          <Ionicons name="warning" size={11} color={T.danger} />
          <Text style={[styles.headerPillText, { color: T.danger }]}>Error</Text>
        </View>
      </LinearGradient>

      {/* Card body */}
      <View style={styles.cardBody}>
        {/* Error icon */}
        <View style={styles.errorIconWrapper}>
          <Ionicons name="close-circle" size={44} color={T.danger} />
        </View>

        <Text style={styles.cardHeading}>Setup Failed</Text>
        <Text style={styles.cardSubText}>
          {message ?? `We couldn't create a ${assetCode} trustline. Please try again.`}
        </Text>

        {/* Retry CTA — mirrors AppButton primary */}
        <TouchableOpacity style={styles.retryBtn} onPress={onDismiss} activeOpacity={0.82}>
          <LinearGradient
            colors={[T.navy, T.navyMid]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.retryBtnGradient}
          >
            <Ionicons name="refresh" size={16} color={T.white} style={{ marginRight: 8 }} />
            <Text style={styles.retryBtnText}>Try Again</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Secondary dismiss link */}
        <TouchableOpacity onPress={onDismiss} activeOpacity={0.7} style={styles.dismissLink}>
          <Text style={styles.dismissLinkText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Circle action button (matches Send / Receive / Transfer siblings) ──
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

  // ── Backdrop ──────────────────────────────────────────────────────────────
  backdrop: {
    flex: 1,
    backgroundColor: T.overlayBg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  // ── Shared card shell ────────────────────────────────────────────────────
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: T.surface,
    borderRadius: 24,
    overflow: 'hidden',
    // Drop shadow matching app's card shadow token
    shadowColor: T.shadowNavy,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.35,
    shadowRadius: 36,
    elevation: 20,
    borderWidth: 1,
    borderColor: T.borderSoft,
  },

  // ── Gradient header strip ─────────────────────────────────────────────────
  cardHeader: {
    height: 80,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  headerDot: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: T.white10,
    top: -50,
    right: -30,
  },
  headerDotSm: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: T.white06,
    bottom: -20,
    left: 80,
  },
  wordmark: {
    color: T.white80,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 4,
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: T.white10,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.white20,
  },
  headerPillDanger: {
    backgroundColor: 'rgba(240, 68, 56, 0.15)',
    borderColor: 'rgba(240, 68, 56, 0.30)',
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: T.success,
  },
  headerPillText: {
    color: T.white,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  // ── Card body ────────────────────────────────────────────────────────────
  cardBody: {
    padding: 28,
    alignItems: 'center',
  },

  // ── Spinner ──────────────────────────────────────────────────────────────
  spinnerWrapper: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  spinnerRing: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2.5,
    borderColor: T.navyAccent,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
  },
  spinnerInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: T.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.borderSoft,
  },

  // ── Copy ─────────────────────────────────────────────────────────────────
  cardHeading: {
    color: T.ink,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
    lineHeight: 27,
    marginBottom: 8,
  },
  cardSubText: {
    color: T.muted,
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
    paddingHorizontal: 8,
  },

  // ── Dots progress indicator ───────────────────────────────────────────────
  dotsRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: T.navyAccent,
  },

  // ── Error icon ────────────────────────────────────────────────────────────
  errorIconWrapper: {
    marginBottom: 16,
  },

  // ── Retry button (matches AppButton primary + LinearGradient) ─────────────
  retryBtn: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 4,
    shadowColor: T.shadowNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  retryBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  retryBtnText: {
    color: T.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // ── Dismiss link ──────────────────────────────────────────────────────────
  dismissLink: {
    marginTop: 14,
    paddingVertical: 6,
  },
  dismissLinkText: {
    color: T.muted,
    fontSize: 13,
    fontWeight: '600',
  },
});
