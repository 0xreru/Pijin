/**
 * Sep24WebviewScreen.tsx
 *
 * Pijin SEP-24 Interactive Deposit WebView
 * ────────────────────────────────────────
 *
 * Fully aligned with the app's design language:
 *  - White background (#FFFFFF) body, deep navy (#02132B → #04224C) header
 *  - expo-linear-gradient for the header strip (matches BalanceCard gradient)
 *  - Native Animated API for smooth progress bar + success overlay
 *  - Consistent typography, border radii, and shadow tokens from theme.ts & typography.ts
 *
 * Navigation params
 * ─────────────────
 * • url           — The interactive URL returned by the anchor (required).
 * • assetCode     — e.g. "PHPC" or "USDC" — shown in the header subtitle.
 * • transactionId — The SEP-24 tx ID (shown as a compact chip).
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Animated,
  DeviceEventEmitter,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ANCHOR_DOMAIN } from '../services/stellar/anchorService';
import { typography } from '../constants/typography';

// ─── Theme tokens (mirrors app-wide theme.ts + BalanceCard colors) ────────────

const T = {
  navyDark: '#02132B',
  navy: '#031634',
  navyMid: '#04224C',
  navyAccent: '#001E42',
  success: '#16C784',
  danger: '#F04438',
  surface: '#FFFFFF',
  surfaceSoft: '#F5F5F6',
  surfaceMuted: '#F0F0F0',
  border: '#DADADA',
  borderSoft: '#E6E9EE',
  ink: '#08090A',
  inkSoft: '#3F4144',
  muted: '#707984',
  mutedDark: '#55575A',
  shadow: '#000000',
  shadowNavy: '#031634',
  white: '#FFFFFF',
  white80: 'rgba(255,255,255,0.80)',
  white50: 'rgba(255,255,255,0.50)',
  white20: 'rgba(255,255,255,0.20)',
  white10: 'rgba(255,255,255,0.10)',
  white06: 'rgba(255,255,255,0.06)',
};

// ─── CSS Injection Script ─────────────────────────────────────────────────────

const INJECTED_JS = `
  (function() {
    const style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = \\\`
      /* Force body styling to match app theme */
      body, html {
        background-color: #FFFFFF !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        color: #08090A !important;
        padding: 20px 16px !important;
        margin: 0 !important;
        min-height: 100% !important;
      }
      
      /* Typography styling */
      h1, h2, h3, h4, h5, h6 {
        color: #02132B !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-weight: 800 !important;
        letter-spacing: -0.3px !important;
        margin-top: 8px !important;
        margin-bottom: 12px !important;
      }
      h1 { font-size: 24px !important; line-height: 30px !important; }
      h2 { font-size: 20px !important; line-height: 26px !important; }
      h3 { font-size: 18px !important; line-height: 24px !important; }
      
      p, span, label, li, td, th {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        color: #3F4144 !important;
        font-size: 14px !important;
        line-height: 20px !important;
      }
      
      label {
        color: #02132B !important;
        font-weight: 700 !important;
        display: block !important;
        margin-bottom: 6px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
        font-size: 11px !important;
      }

      /* Container and forms */
      form {
        margin-top: 16px !important;
      }
      
      /* Input elements */
      input[type="text"],
      input[type="number"],
      input[type="email"],
      input[type="tel"],
      input[type="password"],
      input[type="url"],
      select,
      textarea {
        background-color: #FFFFFF !important;
        border: 1.5px solid #DADADA !important;
        border-radius: 10px !important;
        padding: 12px 14px !important;
        color: #08090A !important;
        font-size: 15px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        margin-bottom: 16px !important;
        outline: none !important;
        width: 100% !important;
        box-sizing: border-box !important;
        transition: border-color 0.2s ease, box-shadow 0.2s ease !important;
      }
      
      input:focus, select:focus, textarea:focus {
        border-color: #02132B !important;
        box-shadow: 0 0 0 3px rgba(2, 19, 43, 0.08) !important;
      }

      /* Placeholders */
      ::placeholder {
        color: #707984 !important;
        opacity: 0.8 !important;
      }

      /* Buttons & CTA Actions */
      button,
      .button,
      .btn,
      input[type="submit"],
      input[type="button"],
      a.btn,
      a.button {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: linear-gradient(135deg, #02132B, #04224C) !important;
        color: #FFFFFF !important;
        border: none !important;
        border-radius: 10px !important;
        padding: 14px 20px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-weight: 700 !important;
        font-size: 15px !important;
        letter-spacing: 0.2px !important;
        text-decoration: none !important;
        cursor: pointer !important;
        width: 100% !important;
        box-sizing: border-box !important;
        margin-top: 10px !important;
        margin-bottom: 10px !important;
        box-shadow: 0 4px 10px rgba(2, 19, 43, 0.15) !important;
        transition: transform 0.15s ease, opacity 0.15s ease !important;
      }
      
      button:active,
      .button:active,
      .btn:active,
      input[type="submit"]:active,
      input[type="button"]:active {
        transform: scale(0.97) !important;
        opacity: 0.9 !important;
      }

      /* Helper alert messages/boxes inside the web page */
      .alert, .error, .success, .info {
        border-radius: 10px !important;
        padding: 12px 16px !important;
        margin-bottom: 16px !important;
        font-size: 14px !important;
      }
      
      .alert-danger, .error, .error-message {
        background-color: rgba(240, 68, 56, 0.08) !important;
        border: 1px solid rgba(240, 68, 56, 0.2) !important;
        color: #F04438 !important;
      }

      .alert-success, .success, .success-message {
        background-color: rgba(22, 199, 132, 0.08) !important;
        border: 1px solid rgba(22, 199, 132, 0.2) !important;
        color: #16C784 !important;
      }
    \\\`;
    document.head.appendChild(style);
  })();
  true;
`;

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export function Sep24WebviewScreen({ route, navigation }: Sep24WebviewScreenProps) {
  const { url, assetCode, transactionId } = route.params;
  const insets = useSafeAreaInsets();

  const [isLoaded, setIsLoaded] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [hasError, setHasError] = useState(false);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressOpacity = useRef(new Animated.Value(1)).current;
  const successFadeAnim = useRef(new Animated.Value(0)).current;
  const successScaleAnim = useRef(new Animated.Value(0.85)).current;
  const headerSubtitleAnim = useRef(new Animated.Value(1)).current;

  // Animate progress bar width
  const animateProgress = (toValue: number) => {
    Animated.timing(progressAnim, {
      toValue,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  };

  const handleLoadProgress = ({ nativeEvent }: { nativeEvent: { progress: number } }) => {
    const progress = nativeEvent.progress;
    animateProgress(progress);
    if (progress >= 1) {
      // Fade out the progress bar smoothly once page is done loading
      setTimeout(() => {
        Animated.timing(progressOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: false,
        }).start(() => setIsLoaded(true));
      }, 200);
    }
  };

  const handleNavigationStateChange = (navState: WebViewNavigation) => {
    const successUrl = navState.url;
    if (
      successUrl.includes('status=completed') ||
      successUrl.includes('/deposit/success') ||
      successUrl.includes('/success')
    ) {
      triggerSuccess();
    }
  };

  const triggerSuccess = () => {
    setIsSuccess(true);
    // Animate header subtitle cross-fade
    Animated.timing(headerSubtitleAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      Animated.timing(headerSubtitleAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    });
    // Animate success overlay
    Animated.parallel([
      Animated.timing(successFadeAnim, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(successScaleAnim, {
        toValue: 1,
        speed: 14,
        bounciness: 8,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleClose = () => {
    // Signal the Dashboard to start polling for the updated balance.
    // Fires on both "Done" (after success) and manual "Close".
    DeviceEventEmitter.emit('ON_DEPOSIT_COMPLETE');
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.container, { backgroundColor: T.surface }]}>
      {/* ── Header (navy gradient, matches BalanceCard) ── */}
      <LinearGradient
        colors={[T.navyDark, T.navyMid]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top > 0 ? insets.top : 16 }]}
      >
        {/* Decorative blobs inside header */}
        <View style={styles.headerBlobLg} />
        <View style={styles.headerBlobSm} />

        <View style={styles.headerContent}>
          {/* Left — wordmark + screen title */}
          <View style={styles.headerLeft}>
            <Text style={styles.wordmark}>PIJIN</Text>
            <Animated.Text style={[styles.headerTitle, { opacity: headerSubtitleAnim }]}>
              {isSuccess ? 'Deposit Complete' : `Deposit ${assetCode}`}
            </Animated.Text>
          </View>

          {/* Right — Close / Done button */}
          <TouchableOpacity
            style={[styles.closeButton, isSuccess && styles.closeButtonSuccess]}
            onPress={handleClose}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel="Close deposit webview"
            testID="sep24-close-button"
          >
            {isSuccess ? (
              <Ionicons name="checkmark" size={16} color={T.success} style={{ marginRight: 4 }} />
            ) : (
              <Ionicons name="close" size={16} color={T.white80} style={{ marginRight: 4 }} />
            )}
            <Text style={[styles.closeButtonText, isSuccess && styles.closeButtonTextSuccess]}>
              {isSuccess ? 'Done' : 'Close'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Animated progress bar — fades out when fully loaded */}
        <Animated.View style={[styles.progressTrack, { opacity: progressOpacity }]}>
          <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
        </Animated.View>
      </LinearGradient>

      {/* ── Transaction ID chip ── */}
      {transactionId && (
        <View style={styles.txChipRow}>
          <View style={styles.txChip}>
            <View style={styles.txDot} />
            <Text style={styles.txChipText} numberOfLines={1}>
              TX: {transactionId.slice(0, 8)}…{transactionId.slice(-6)}
            </Text>
          </View>
        </View>
      )}

      {/* ── WebView container ── */}
      <View style={styles.webviewContainer}>
        {/* Initial loading overlay */}
        {!isLoaded && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingSpinnerWrapper}>
              <ActivityIndicator size="large" color={T.navyAccent} />
            </View>
            <Text style={styles.loadingTitle}>Loading deposit form</Text>
            <Text style={styles.loadingSubText}>Connecting to secure anchor…</Text>
          </View>
        )}

        {/* Success overlay */}
        {isSuccess && (
          <Animated.View
            style={[
              styles.successOverlay,
              { opacity: successFadeAnim, transform: [{ scale: successScaleAnim }] },
            ]}
          >
            {/* Success icon with navy bg */}
            <LinearGradient
              colors={[T.navyDark, T.navyMid]}
              style={styles.successIconCircle}
            >
              <Ionicons name="checkmark" size={38} color={T.success} />
            </LinearGradient>

            <Text style={styles.successTitle}>Deposit Initiated!</Text>
            <Text style={styles.successSubtitle}>
              Your {assetCode} deposit is being processed.{'\n'}Tap "Done" to return to your wallet.
            </Text>

            {/* Done CTA */}
            <TouchableOpacity style={styles.doneBtn} onPress={handleClose} activeOpacity={0.82}>
              <LinearGradient
                colors={[T.navyDark, T.navyMid]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.doneBtnGradient}
              >
                <Text style={styles.doneBtnText}>Done</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Error state */}
        {hasError && (
          <View style={styles.errorOverlay}>
            <View style={styles.errorIconWrapper}>
              <Ionicons name="wifi-outline" size={36} color={T.danger} />
            </View>
            <Text style={styles.errorTitle}>Connection Error</Text>
            <Text style={styles.errorSubtitle}>
              Could not load the deposit form.{'\n'}Please check your connection and try again.
            </Text>
            <TouchableOpacity style={styles.goBackBtn} onPress={handleClose} activeOpacity={0.82}>
              <Text style={styles.goBackBtnText}>Go Back</Text>
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
          injectedJavaScript={INJECTED_JS}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode={Platform.OS === 'android' ? 'compatibility' : undefined}
          setSupportMultipleWindows={false}
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
    backgroundColor: T.surface,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 20,
    paddingBottom: 0,
    overflow: 'hidden',
    // Subtle shadow below header to separate from white body
    shadowColor: T.shadowNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 10,
  },
  headerBlobLg: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: T.white10,
    top: -80,
    right: -40,
  },
  headerBlobSm: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: T.white06,
    bottom: -20,
    left: 60,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  headerLeft: {
    gap: 3,
  },
  wordmark: {
    color: T.white50,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 4,
  },
  headerTitle: {
    color: T.white,
    fontSize: typography.screenTitle.fontSize,
    lineHeight: typography.screenTitle.lineHeight,
    fontWeight: typography.screenTitle.fontWeight,
    letterSpacing: -0.3,
  },

  // ── Close / Done button ───────────────────────────────────────────────────
  closeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: T.white10,
    borderWidth: 1,
    borderColor: T.white20,
  },
  closeButtonSuccess: {
    backgroundColor: 'rgba(22, 199, 132, 0.15)',
    borderColor: 'rgba(22, 199, 132, 0.35)',
  },
  closeButtonText: {
    color: T.white80,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  closeButtonTextSuccess: {
    color: T.success,
  },

  // ── Progress bar ──────────────────────────────────────────────────────────
  progressTrack: {
    height: 3,
    backgroundColor: T.white10,
    marginHorizontal: -20,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: T.success,
    borderRadius: 1.5,
  },

  // ── TX chip ───────────────────────────────────────────────────────────────
  txChipRow: {
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: T.surfaceSoft,
    borderBottomWidth: 1,
    borderBottomColor: T.borderSoft,
  },
  txChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.surfaceMuted,
    borderWidth: 1,
    borderColor: T.border,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  txDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: T.success,
  },
  txChipText: {
    color: T.mutedDark,
    fontSize: typography.caption.fontSize - 2,
    fontWeight: '600',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },

  // ── WebView container ──────────────────────────────────────────────────────
  webviewContainer: {
    flex: 1,
    backgroundColor: T.surface,
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: T.surface,
  },

  // ── Loading overlay ───────────────────────────────────────────────────────
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: T.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 10,
  },
  loadingSpinnerWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: T.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.borderSoft,
    marginBottom: 4,
    shadowColor: T.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  loadingTitle: {
    color: T.ink,
    fontSize: typography.body.fontSize + 1,
    lineHeight: typography.body.lineHeight,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  loadingSubText: {
    color: T.muted,
    fontSize: typography.caption.fontSize,
    fontWeight: '400',
  },

  // ── Success overlay ───────────────────────────────────────────────────────
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: T.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 14,
    zIndex: 20,
  },
  successIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: T.shadowNavy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 6,
  },
  successTitle: {
    color: T.ink,
    fontSize: typography.title.fontSize,
    lineHeight: typography.title.lineHeight,
    fontWeight: typography.title.fontWeight,
    letterSpacing: -0.4,
  },
  successSubtitle: {
    color: T.muted,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlign: 'center',
  },

  // ── Done CTA button ───────────────────────────────────────────────────────
  doneBtn: {
    marginTop: 8,
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: T.shadowNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  doneBtnGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: T.white,
    fontSize: typography.button.fontSize - 4,
    lineHeight: typography.button.lineHeight,
    fontWeight: typography.button.fontWeight,
    letterSpacing: 0.2,
  },

  // ── Error overlay ─────────────────────────────────────────────────────────
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: T.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
    zIndex: 20,
  },
  errorIconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(240, 68, 56, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(240, 68, 56, 0.20)',
    marginBottom: 6,
  },
  errorTitle: {
    color: T.ink,
    fontSize: typography.title.fontSize,
    lineHeight: typography.title.lineHeight,
    fontWeight: typography.title.fontWeight,
    letterSpacing: -0.3,
  },
  errorSubtitle: {
    color: T.muted,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlign: 'center',
  },
  goBackBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
    backgroundColor: T.surfaceSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.border,
  },
  goBackBtnText: {
    color: T.inkSoft,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
});
