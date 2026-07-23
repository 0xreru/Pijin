/**
 * Sep24WebviewScreen.tsx
 *
 * Pijin SEP-24 Interactive Deposit / Withdrawal WebView
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

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  DeviceEventEmitter,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ANCHOR_DOMAIN,
  AnchorServiceError,
  confirmSep24WithdrawalPayment,
  getSep24WithdrawalInstructions,
  Keypair as StellarKeypair,
  submitSep24WithdrawalPayment,
} from '../services/stellar/anchorService';
import { getMainWalletSecret } from '../services/storage/onboardingStorage';
import { typography } from '../constants/typography';
import { ErrorModal } from '../components/ui/ErrorModal';

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
    style.innerHTML = \`
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
        color: #031634 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-weight: 800 !important;
        letter-spacing: -0.3px !important;
        margin-top: 8px !important;
        margin-bottom: 12px !important;
      }
      h1 { font-size: 24px !important; line-height: 30px !important; }
      h2 { font-size: 20px !important; line-height: 26px !important; }
      h3 { font-size: 18px !important; line-height: 24px !important; }
      
      p, span, li, td, th {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        color: #707984 !important;
        font-size: 14px !important;
        line-height: 20px !important;
      }
      
      label {
        color: #031634 !important;
        font-weight: 700 !important;
        display: block !important;
        margin-bottom: 8px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
        font-size: 12px !important;
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
        border: 1.5px solid #E6E9EE !important;
        border-radius: 8px !important;
        padding: 14px 16px !important;
        color: #031634 !important;
        font-size: 16px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        margin-bottom: 20px !important;
        outline: none !important;
        width: 100% !important;
        box-sizing: border-box !important;
        transition: border-color 0.2s ease, box-shadow 0.2s ease !important;
      }
      
      input:focus, select:focus, textarea:focus {
        border-color: #031634 !important;
      }

      /* Placeholders */
      ::placeholder {
        color: #9CA3AF !important;
        opacity: 1 !important;
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
        background-color: #031634 !important;
        color: #FFFFFF !important;
        border: none !important;
        border-radius: 8px !important;
        padding: 16px 20px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-weight: 700 !important;
        font-size: 16px !important;
        letter-spacing: 0.2px !important;
        text-decoration: none !important;
        cursor: pointer !important;
        width: 100% !important;
        box-sizing: border-box !important;
        margin-top: 10px !important;
        margin-bottom: 10px !important;
        box-shadow: 0 4px 10px rgba(3, 22, 52, 0.15) !important;
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
        border-radius: 8px !important;
        padding: 16px !important;
        margin-bottom: 20px !important;
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
    \`;
    document.head.appendChild(style);

    // Forward the withdrawal page's browser postMessage into React Native.
    const forwardSep24Handoff = function(event) {
      const data = event && event.data;
      if (
        data &&
        typeof data === 'object' &&
        data.type === 'success' &&
        data.status === 'pending_user_transfer_start' &&
        window.ReactNativeWebView
      ) {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      }
    };
    window.addEventListener('message', forwardSep24Handoff);
    document.addEventListener('message', forwardSep24Handoff);

    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'sep24_bridge_ready' }));
    }
  })();
  true;
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Sep24WebviewRouteParams {
  url: string;
  assetCode: string;
  transactionId?: string;
  flow?: 'deposit' | 'withdrawal';
  sep10Token?: string;
}

interface Sep24WebviewScreenProps {
  route: { params: Sep24WebviewRouteParams };
  navigation: {
    goBack: () => void;
    canGoBack: () => boolean;
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function Sep24WebviewScreen({ route, navigation }: Sep24WebviewScreenProps) {
  const {
    url,
    assetCode,
    transactionId,
    flow = 'deposit',
    sep10Token,
  } = route.params;
  const isWithdrawal = flow === 'withdrawal';
  const insets = useSafeAreaInsets();

  const [isLoaded, setIsLoaded] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isProcessingWithdrawal, setIsProcessingWithdrawal] = useState(false);
  const [withdrawalHandoffReceived, setWithdrawalHandoffReceived] = useState(false);
  const withdrawalInFlightRef = useRef(false);

  // Modal states
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmData, setConfirmData] = useState<{
    amount: string;
    assetCode: string;
    destination: string;
    memo?: string;
    resolve: (value: boolean) => void;
  } | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressOpacity = useRef(new Animated.Value(1)).current;
  const headerSubtitleAnim = useRef(new Animated.Value(1)).current;

  const confirmNativeWithdrawal = (input: {
    amount: string;
    assetCode: string;
    destination: string;
    memo?: string;
  }): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmData({ ...input, resolve });
      setConfirmModalVisible(true);
    });
  };

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
    // Deposit retains its existing URL-based success behavior. Withdrawal only
    // succeeds after the native wallet payment is confirmed by Horizon.
    if (isWithdrawal) return;
    const successUrl = navState.url;
    if (
      successUrl.includes('status=completed') ||
      successUrl.includes('/deposit/success') ||
      successUrl.includes('/success')
    ) {
      triggerSuccess();
    }
  };

  const handleWebViewMessage = async (event: WebViewMessageEvent) => {
    if (!isWithdrawal || withdrawalInFlightRef.current) return;

    let message: unknown;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      console.warn('[Sep24Withdrawal] Ignored non-JSON WebView message.');
      return;
    }

    if (isRecord(message) && message.type === 'sep24_bridge_ready') {
      console.info('[Sep24Withdrawal] WebView bridge ready.');
      return;
    }

    if (
      !isRecord(message) ||
      message.type !== 'success' ||
      message.status !== 'pending_user_transfer_start'
    ) {
      return;
    }

    console.info(`[Sep24Withdrawal] Handoff received | transactionId=${transactionId ?? 'missing'}`);
    withdrawalInFlightRef.current = true;
    setWithdrawalHandoffReceived(true);
    setIsProcessingWithdrawal(true);
    setHasError(false);
    setErrorMessage('');

    try {
      if (!transactionId || !sep10Token) {
        throw new Error('Withdrawal session is missing its authenticated transaction details.');
      }

      const mainWalletSecret = await getMainWalletSecret();
      if (!mainWalletSecret) {
        throw new Error('Main wallet not found. Please sign in again.');
      }
      const keypair = StellarKeypair.fromSecret(mainWalletSecret);
      console.info(`[Sep24Withdrawal] Wallet loaded | account=${keypair.publicKey()}`);

      // SECURITY: destination, amount, and memo come only from the authenticated
      // polling endpoint. Webview-controlled payment fields are never trusted.
      const instructions = await getSep24WithdrawalInstructions(
        transactionId,
        sep10Token,
        keypair.publicKey(),
      );
      console.info(
        `[Sep24Withdrawal] Instructions verified | amount=${instructions.amount} | asset=${instructions.assetCode}`,
      );

      const confirmed = await confirmNativeWithdrawal({
        amount: instructions.amount,
        assetCode: instructions.assetCode,
        destination: instructions.destination,
        memo: instructions.memo,
      });

      if (!confirmed) {
        console.info('[Sep24Withdrawal] User cancelled wallet transfer confirmation.');
        setIsProcessingWithdrawal(false);
        if (navigation.canGoBack()) navigation.goBack();
        return;
      }

      console.info('[Sep24Withdrawal] Building and submitting Stellar payment.');
      const payment = await submitSep24WithdrawalPayment(instructions, keypair);
      console.info(`[Sep24Withdrawal] Horizon confirmed payment | hash=${payment.hash}`);
      console.info('[Sep24Withdrawal] Asking anchor to verify the payment.');
      await confirmSep24WithdrawalPayment(transactionId, sep10Token, payment.hash);
      console.info('[Sep24Withdrawal] Anchor moved withdrawal to pending_external.');
      setIsProcessingWithdrawal(false);
      triggerSuccess();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'The withdrawal transfer failed.';
      const diagnostic = error instanceof AnchorServiceError ? error.detail : undefined;
      console.error(
        `[Sep24Withdrawal] Native transfer failed | code=${
          error instanceof AnchorServiceError ? error.code : 'UNKNOWN'
        } | detail=${diagnostic ?? 'none'}`,
        error,
      );
      setErrorMessage(diagnostic ? `${message}\n${diagnostic}` : message);
      setIsProcessingWithdrawal(false);
      setHasError(true);
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
  };

  const handleClose = () => {
    // Reuse the existing balance-refresh event. Deposit behavior is unchanged;
    // after withdrawal it refreshes the reduced online wallet balance.
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
              {isSuccess
                ? (isWithdrawal ? 'Cash Out Sent' : 'Deposit Complete')
                : (isWithdrawal ? `Cash Out ${assetCode}` : `Deposit ${assetCode}`)}
            </Animated.Text>
          </View>

          {/* Right — Close / Done button */}
          <TouchableOpacity
            style={[styles.closeButton, isSuccess && styles.closeButtonSuccess]}
            onPress={handleClose}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel={`Close ${isWithdrawal ? 'withdrawal' : 'deposit'} webview`}
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
        {!isLoaded && !withdrawalHandoffReceived && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingSpinnerWrapper}>
              <ActivityIndicator size="large" color={T.navyAccent} />
            </View>
            <Text style={styles.loadingTitle}>
              {isWithdrawal ? 'Loading cash out form' : 'Loading deposit form'}
            </Text>
            <Text style={styles.loadingSubText}>Connecting to secure anchor…</Text>
          </View>
        )}

        {isProcessingWithdrawal && !hasError && !isSuccess && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingSpinnerWrapper}>
              <ActivityIndicator size="large" color={T.navyAccent} />
            </View>
            <Text style={styles.loadingTitle}>Preparing secure transfer</Text>
            <Text style={styles.loadingSubText}>
              Verifying Treasury payment instructions…
            </Text>
          </View>
        )}

        {/* Success Modal */}
        <ErrorModal
          visible={isSuccess}
          variant="success"
          title={isWithdrawal ? 'Withdrawal Transfer Sent!' : 'Deposit Initiated!'}
          message={
            isWithdrawal
              ? `Your ${assetCode} was sent to the anchor Treasury. Your fiat payout will be processed after confirmation.\n\nTap "Done" to return to your wallet.`
              : `Your ${assetCode} deposit is being processed.\n\nTap "Done" to return to your wallet.`
          }
          onDismiss={handleClose}
          primaryButtonText="Done"
        />

        {/* Error Modal */}
        <ErrorModal
          visible={hasError}
          variant="error"
          title={isWithdrawal ? 'Withdrawal Failed' : 'Connection Error'}
          message={
            errorMessage ||
            (isWithdrawal
              ? 'The online wallet transfer could not be completed.'
              : 'Could not load the deposit form. Please check your connection and try again.')
          }
          onDismiss={handleClose}
          primaryButtonText="Go Back"
        />

        {/* Confirmation Modal */}
        <Modal
          visible={confirmModalVisible}
          transparent
          animationType="fade"
          statusBarTranslucent
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Confirm Cash Out</Text>
              <Text style={styles.modalMessage}>
                Send <Text style={{ fontWeight: '800', color: T.ink }}>{confirmData?.amount} {confirmData?.assetCode}</Text> from your online wallet to the anchor Treasury?
              </Text>
              
              <View style={styles.modalDetailBox}>
                <Text style={styles.modalDetailLabel}>Treasury Address</Text>
                <Text style={styles.modalDetailText}>
                  {confirmData?.destination ? `${confirmData.destination.slice(0, 8)}…${confirmData.destination.slice(-8)}` : ''}
                </Text>
                
                {confirmData?.memo && (
                  <>
                    <View style={styles.modalDivider} />
                    <Text style={styles.modalDetailLabel}>Memo</Text>
                    <Text style={styles.modalDetailText}>{confirmData.memo}</Text>
                  </>
                )}
              </View>

              <View style={styles.modalButtonRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => {
                    setConfirmModalVisible(false);
                    confirmData?.resolve(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.modalConfirmBtn}
                  onPress={() => {
                    setConfirmModalVisible(false);
                    confirmData?.resolve(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalConfirmText}>Transfer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {!withdrawalHandoffReceived && <WebView
          source={{ uri: url }}
          style={styles.webview}
          originWhitelist={[
            `https://${ANCHOR_DOMAIN}`,
            `https://*.${ANCHOR_DOMAIN}`,
          ]}
          onLoadProgress={handleLoadProgress}
          onNavigationStateChange={handleNavigationStateChange}
          onMessage={handleWebViewMessage}
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
        />}
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

  // ── Modal Styles ─────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 19, 43, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: T.surface,
    borderRadius: 24,
    padding: 24,
    shadowColor: T.shadowNavy,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: T.navyDark,
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 15,
    color: T.muted,
    lineHeight: 22,
    marginBottom: 20,
  },
  modalDetailBox: {
    backgroundColor: T.surfaceSoft,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: T.borderSoft,
  },
  modalDetailLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: T.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  modalDetailText: {
    fontSize: 14,
    fontWeight: '600',
    color: T.navyDark,
  },
  modalDivider: {
    height: 1,
    backgroundColor: T.borderSoft,
    marginVertical: 12,
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelBtn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: T.surfaceSoft,
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: T.inkSoft,
  },
  modalConfirmBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: T.navyMid,
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: T.white,
  },
});
