/**
 * Sep24WebviewScreen.tsx
 *
 * Pijin SEP-24 Interactive Deposit WebView
 * ─────────────────────────────────────────
 *
 * Renders the anchor's interactive deposit URL inside a full-screen WebView.
 * The anchor serves a mobile-optimised form at this URL where the user enters
 * their deposit amount and bank details.
 *
 * Navigation params
 * ─────────────────
 * • url           — The interactive URL returned by the anchor (required).
 * • assetCode     — e.g. "PHPC" or "USDC" — shown in the header subtitle.
 * • transactionId — The SEP-24 tx ID for polling (optional, for future use).
 *
 * UX decisions
 * ────────────
 * • The header uses Pijin's deep navy (#001233) palette to stay on-brand.
 * • A custom loading indicator appears while the anchor page is fetching,
 *   keeping the experience smooth and branded.
 * • A "Done" button in the top-right lets the user dismiss manually after
 *   the anchor page confirms success (or if they abandon the flow).
 * • The WebView is configured to allow inline media, JS, and the anchor's
 *   specific origin to prevent accidental data leaks to unknown domains.
 */

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { ANCHOR_DOMAIN } from '../services/stellar/anchorService';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Route params expected by this screen.
 * In your navigator you should declare:
 *
 * ```ts
 * Sep24Webview: {
 *   url: string;
 *   assetCode: string;
 *   transactionId?: string;
 * };
 * ```
 */
interface Sep24WebviewRouteParams {
  url: string;
  assetCode: string;
  transactionId?: string;
}

interface Sep24WebviewScreenProps {
  route: { params: Sep24WebviewRouteParams };
  navigation: {
    goBack: () => void;
    canGoBack: () => boolean;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PIJIN_DEEP_NAVY = '#001233';
const PIJIN_NAVY = '#002855';
const PIJIN_ACCENT = '#4A90D9';
const PIJIN_WHITE = '#FFFFFF';
const PIJIN_WHITE_60 = 'rgba(255,255,255,0.60)';
const PIJIN_WHITE_15 = 'rgba(255,255,255,0.15)';
const PIJIN_WHITE_08 = 'rgba(255,255,255,0.08)';
const PIJIN_SUCCESS = '#22C55E';

// ─── Component ────────────────────────────────────────────────────────────────

export function Sep24WebviewScreen({ route, navigation }: Sep24WebviewScreenProps) {
  const { url, assetCode, transactionId } = route.params;
  const insets = useSafeAreaInsets();

  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [hasError, setHasError] = useState(false);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const successFadeAnim = useRef(new Animated.Value(0)).current;

  // Animate progress bar width.
  const animateProgress = (toValue: number) => {
    Animated.timing(progressAnim, {
      toValue,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  };

  const handleLoadProgress = ({ nativeEvent }: { nativeEvent: { progress: number } }) => {
    const progress = nativeEvent.progress;
    setLoadingProgress(progress);
    animateProgress(progress);
    if (progress >= 1) {
      setTimeout(() => setIsLoaded(true), 200);
    }
  };

  const handleNavigationStateChange = (navState: WebViewNavigation) => {
    // Detect anchor success redirects.
    // The Pijin anchor appends `?status=completed` or redirects to a success path.
    const successUrl = navState.url;
    if (
      successUrl.includes('status=completed') ||
      successUrl.includes('/deposit/success') ||
      successUrl.includes('/success')
    ) {
      setIsSuccess(true);
      Animated.timing(successFadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  };

  const handleClose = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        {/* Decorative blob */}
        <View style={styles.headerBlob} />

        <View style={styles.headerContent}>
          {/* Left — wordmark */}
          <View style={styles.headerLeft}>
            <Text style={styles.wordmark}>pijin</Text>
            <Text style={styles.headerSubtitle}>
              {isSuccess ? 'Deposit Complete ✓' : `Deposit ${assetCode}`}
            </Text>
          </View>

          {/* Right — Done button */}
          <TouchableOpacity
            style={[styles.doneButton, isSuccess && styles.doneButtonSuccess]}
            onPress={handleClose}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Close deposit webview"
            testID="sep24-close-button"
          >
            <Text style={[styles.doneButtonText, isSuccess && styles.doneButtonTextSuccess]}>
              {isSuccess ? 'Done ✓' : 'Close'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Progress bar — visible while page is loading */}
        {!isLoaded && (
          <View style={styles.progressTrack}>
            <Animated.View
              style={[styles.progressFill, { width: progressWidth }]}
            />
          </View>
        )}
      </View>

      {/* ── Transaction ID chip (debug / UX info) ── */}
      {transactionId && (
        <View style={styles.txChip}>
          <View style={styles.txDot} />
          <Text style={styles.txChipText} numberOfLines={1}>
            TX: {transactionId.slice(0, 8)}…{transactionId.slice(-6)}
          </Text>
        </View>
      )}

      {/* ── WebView ── */}
      <View style={styles.webviewContainer}>
        {/* Initial loading overlay */}
        {!isLoaded && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={PIJIN_ACCENT} />
            <Text style={styles.loadingText}>Loading secure deposit form…</Text>
          </View>
        )}

        {/* Success overlay */}
        {isSuccess && (
          <Animated.View style={[styles.successOverlay, { opacity: successFadeAnim }]}>
            <View style={styles.successIcon}>
              <Text style={styles.successIconText}>✓</Text>
            </View>
            <Text style={styles.successTitle}>Deposit Initiated!</Text>
            <Text style={styles.successSubtitle}>
              Your {assetCode} deposit is being processed. Tap "Done" to return to
              your wallet.
            </Text>
          </Animated.View>
        )}

        {/* Error state */}
        {hasError && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorIcon}>⚠</Text>
            <Text style={styles.errorTitle}>Connection Error</Text>
            <Text style={styles.errorSubtitle}>
              Could not load the deposit form. Please check your internet
              connection and try again.
            </Text>
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
              <Text style={styles.closeBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}

        <WebView
          source={{ uri: url }}
          style={styles.webview}
          originWhitelist={[
            `https://${ANCHOR_DOMAIN}`,
            `https://*.${ANCHOR_DOMAIN}`,
          ]}
          onLoadProgress={handleLoadProgress}
          onNavigationStateChange={handleNavigationStateChange}
          onError={() => {
            setHasError(true);
            setIsLoaded(true);
          }}
          onHttpError={({ nativeEvent }) => {
            if (nativeEvent.statusCode >= 500) {
              setHasError(true);
              setIsLoaded(true);
            }
          }}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          // Allow forms and POST actions within the anchor domain.
          mixedContentMode={Platform.OS === 'android' ? 'compatibility' : undefined}
          // Security: prevent the anchor's webview from launching arbitrary apps.
          setSupportMultipleWindows={false}
          // Performance
          cacheEnabled
          renderLoading={() => <View />}
          testID="sep24-webview"
        />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PIJIN_DEEP_NAVY,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    backgroundColor: PIJIN_DEEP_NAVY,
    paddingHorizontal: 20,
    paddingBottom: 0,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: PIJIN_WHITE_15,
    zIndex: 10,
  },
  headerBlob: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: PIJIN_ACCENT,
    opacity: 0.07,
    top: -80,
    right: -40,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  headerLeft: {
    gap: 2,
  },
  wordmark: {
    color: PIJIN_WHITE_60,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 5,
    textTransform: 'uppercase',
  },
  headerSubtitle: {
    color: PIJIN_WHITE,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  // ── Done button ───────────────────────────────────────────────────────────
  doneButton: {
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: PIJIN_WHITE_08,
    borderWidth: 1,
    borderColor: PIJIN_WHITE_15,
  },
  doneButtonSuccess: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderColor: 'rgba(34, 197, 94, 0.35)',
  },
  doneButtonText: {
    color: PIJIN_WHITE,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  doneButtonTextSuccess: {
    color: PIJIN_SUCCESS,
  },

  // ── Progress bar ──────────────────────────────────────────────────────────
  progressTrack: {
    height: 2,
    backgroundColor: PIJIN_WHITE_08,
    marginHorizontal: -20,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: PIJIN_ACCENT,
    borderRadius: 1,
  },

  // ── TX chip ───────────────────────────────────────────────────────────────
  txChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: PIJIN_WHITE_08,
    borderWidth: 1,
    borderColor: PIJIN_WHITE_15,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
  },
  txDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: PIJIN_ACCENT,
  },
  txChipText: {
    color: PIJIN_WHITE_60,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },

  // ── WebView container ─────────────────────────────────────────────────────
  webviewContainer: {
    flex: 1,
    backgroundColor: PIJIN_NAVY,
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: PIJIN_NAVY,
  },

  // ── Loading overlay ───────────────────────────────────────────────────────
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: PIJIN_DEEP_NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    zIndex: 10,
  },
  loadingText: {
    color: PIJIN_WHITE_60,
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Success overlay ───────────────────────────────────────────────────────
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: PIJIN_DEEP_NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 16,
    zIndex: 20,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderWidth: 2,
    borderColor: 'rgba(34, 197, 94, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  successIconText: {
    fontSize: 36,
    color: PIJIN_SUCCESS,
    fontWeight: '700',
  },
  successTitle: {
    color: PIJIN_WHITE,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  successSubtitle: {
    color: PIJIN_WHITE_60,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Error overlay ─────────────────────────────────────────────────────────
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: PIJIN_DEEP_NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 14,
    zIndex: 20,
  },
  errorIcon: {
    fontSize: 40,
    color: '#FF4B6A',
    marginBottom: 8,
  },
  errorTitle: {
    color: PIJIN_WHITE,
    fontSize: 20,
    fontWeight: '700',
  },
  errorSubtitle: {
    color: PIJIN_WHITE_60,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  closeBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
    backgroundColor: PIJIN_NAVY,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PIJIN_WHITE_15,
  },
  closeBtnText: {
    color: PIJIN_WHITE,
    fontSize: 14,
    fontWeight: '600',
  },
});
