import { useState, useEffect, useRef } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, shadows } from './src/constants/theme';
import { radius } from './src/constants/radius';
import { spacing } from './src/constants/spacing';
import { typography } from './src/constants/typography';
import { BottomNavBar, BottomTab } from './src/components/ui/BottomNavBar';
import { MerchantBottomNavBar, MerchantTab } from './src/components/ui/MerchantBottomNavBar';
import { CustomerOnlineScreen } from './src/screens/CustomerOnlineScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { LockFundsScreen } from './src/screens/LockFundsScreen';
import { MerchantDashboardScreen } from './src/screens/merchant/MerchantDashboardScreen';
import { MerchantScannerScreen } from './src/screens/merchant/MerchantScannerScreen';
import { MerchantSetupScreen } from './src/screens/merchant/MerchantSetupScreen';
import { MerchantWalletScreen } from './src/screens/merchant/MerchantWalletScreen';
import { OfflineWalletScreen } from './src/screens/OfflineWalletScreen';
import { OnlineOfflineWalletScreen } from './src/screens/OnlineOfflineWalletScreen';
import { PayAmountScreen } from './src/screens/PayAmountScreen';
import { QRVoucherScreen } from './src/screens/QRVoucherScreen';
import { TransactionStatusScreen } from './src/screens/TransactionStatusScreen';
import { UnlockFundsScreen } from './src/screens/UnlockFundsScreen';
import { WalletSetupScreen } from './src/screens/WalletSetupScreen';
import { clearStoredAccount, loadStoredAccount, type StoredAccount } from './src/services/storage/accountStorage';
import 'react-native-get-random-values';

type ScreenKey =
  | 'onboarding'
  | 'customer-online'
  | 'wallet-setup'
  | 'online-offline-wallet'
  | 'offline-wallet'
  | 'lock-funds'
  | 'transaction-status'
  | 'unlock-funds'
  | 'pay-amount'
  | 'qr-voucher'
  | 'merchant-dashboard'
  | 'merchant-scanner'
  | 'merchant-wallet';

type UserMode = 'customer' | 'merchant';

function AnimatedScreenWrapper({ children, screenKey }: { children: React.ReactNode; screenKey: string }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    fadeAnim.setValue(0);
    slideAnim.setValue(16);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [screenKey]);

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }],
      }}
    >
      {children}
    </Animated.View>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  const [fontLoadTimedOut, setFontLoadTimedOut] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<ScreenKey>('onboarding');
  const [userMode, setUserMode] = useState<UserMode>('customer');
  const [isAppReady, setIsAppReady] = useState(false);
  const [connectedWalletPublicKey, setConnectedWalletPublicKey] = useState<string | null>(null);
  const [activeAccount, setActiveAccount] = useState<StoredAccount | null>(null);
  const [qrAmount, setQrAmount] = useState<number>(0);
  const [qrMerchantShortId, setQrMerchantShortId] = useState<string>('M-DEMO');
  const [merchantScannerState, setMerchantScannerState] = useState<'idle' | 'scanner'>('scanner');
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    if (fontError) {
      console.error('Failed to load Ionicons font:', fontError);
    }
  }, [fontError]);

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      try {
        const account = await loadStoredAccount();

        if (!isMounted) {
          return;
        }

        if (account) {
          setActiveAccount(account);
          setConnectedWalletPublicKey(account.stellarPublicKey);
          const resolvedMode = account.role === 'MERCHANT' ? 'merchant' : 'customer';
          setUserMode(resolvedMode);
          setCurrentScreen(account.role === 'MERCHANT' ? 'merchant-wallet' : 'online-offline-wallet');
        } else {
          setCurrentScreen('onboarding');
        }
      } catch (error) {
        console.error('Failed to load stored account:', error);
        if (isMounted) {
          setCurrentScreen('wallet-setup');
        }
      } finally {
        if (isMounted) {
          setIsAppReady(true);
        }
      }
    };

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      return;
    }

    const timeout = setTimeout(() => {
      setFontLoadTimedOut(true);
      console.warn('Ionicons font load timed out. Continuing app startup.');
    }, 6000);

    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontError]);

  if (!isAppReady || (!fontsLoaded && !fontError && !fontLoadTimedOut)) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <ActivityIndicator size="large" color="#111111" />
        <Text style={{ color: '#4B5563', fontSize: 14 }}>Starting AbotPera...</Text>
      </View>
    );
  }

  function goToLockFunds() {
    setCurrentScreen('lock-funds');
  }

  function goToOfflineWallet() {
    setCurrentScreen('offline-wallet');
  }

  function goToPayAmount() {
    setCurrentScreen('pay-amount');
  }

  function goToQrVoucher(amount: number) {
    setQrAmount(amount);
    setCurrentScreen('qr-voucher');
  }

  function goBackFromQrVoucher() {
    goToPayAmount();
  }

  function handleBottomTabPress(tab: BottomTab) {
    if (tab === 'Home') {
      setCurrentScreen('online-offline-wallet');
      return;
    }

    if (tab === 'Pay') {
      goToPayAmount();
      return;
    }

    if (tab === 'Wallet') {
      setCurrentScreen('offline-wallet');
    }
  }

  function handleMerchantTabPress(tab: MerchantTab) {
    if (tab === 'Dashboard') {
      setCurrentScreen('merchant-dashboard');
      return;
    }

    if (tab === 'Scan') {
      setCurrentScreen('merchant-scanner');
      return;
    }

    if (tab === 'Wallet') {
      setCurrentScreen('merchant-wallet');
    }
  }

  async function handleLogout() {
    setShowLogoutModal(true);
  }

  async function confirmLogout() {
    setShowLogoutModal(false);
    try {
      await clearStoredAccount();
      setActiveAccount(null);
      setConnectedWalletPublicKey(null);
      setCurrentScreen('onboarding');
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  }

  function renderScreen() {
    if (currentScreen === 'onboarding') {
      return (
        <OnboardingScreen
          onFinish={() => setCurrentScreen('customer-online')}
        />
      );
    }

    if (!activeAccount) {
      if (currentScreen === 'customer-online') {
        return (
          <CustomerOnlineScreen
            onContinue={(mode) => {
              setUserMode(mode);
              setCurrentScreen('wallet-setup');
            }}
          />
        );
      }
      return (
        userMode === 'merchant' ? (
          <MerchantSetupScreen
            onBack={() => setCurrentScreen('customer-online')}
            onRegistered={(publicKey, shortId) => {
              setConnectedWalletPublicKey(publicKey);
              setActiveAccount({
                shortId,
                role: 'MERCHANT',
                stellarPublicKey: publicKey,
              });
              setCurrentScreen('merchant-wallet');
            }}
          />
        ) : (
          <WalletSetupScreen
            userMode={userMode}
            onBack={() => setCurrentScreen('customer-online')}
            onWalletConnected={(publicKey, shortId) => {
              setConnectedWalletPublicKey(publicKey);
              const role = userMode === 'merchant' ? 'MERCHANT' : 'CUSTOMER';
              setActiveAccount({
                shortId,
                role,
                stellarPublicKey: publicKey,
              });
              setCurrentScreen(userMode === 'customer' ? 'online-offline-wallet' : 'merchant-wallet');
            }}
          />
        )
      );
    }

    if (currentScreen === 'online-offline-wallet') {
      return (
        <OnlineOfflineWalletScreen
          bottomTab="Home"
          connectedPublicKey={connectedWalletPublicKey ?? undefined}
          shortId={activeAccount?.shortId}
          onBottomTabPress={handleBottomTabPress}
          onLogout={handleLogout}
        />
      );
    }

    if (currentScreen === 'offline-wallet') {
      return (
        <OfflineWalletScreen
          bottomTab="Wallet"
          connectedPublicKey={connectedWalletPublicKey ?? undefined}
          shortId={activeAccount?.shortId}
          onBottomTabPress={handleBottomTabPress}
          onPrepareOfflineCash={goToLockFunds}
          onLogout={handleLogout}
        />
      );
    }

    if (currentScreen === 'pay-amount') {
      return (
        <PayAmountScreen
          connectedPublicKey={connectedWalletPublicKey ?? undefined}
          onBack={goToOfflineWallet}
          onGenerateQr={goToQrVoucher}
        />
      );
    }

    if (currentScreen === 'qr-voucher') {
      return (
        <QRVoucherScreen
          amount={qrAmount}
          customerPublicKey={connectedWalletPublicKey ?? undefined}
          customerShortId={activeAccount?.shortId}
          merchantShortId={qrMerchantShortId}
          onCancel={goBackFromQrVoucher}
        />
      );
    }

    if (currentScreen === 'merchant-dashboard') {
      return (
        <MerchantDashboardScreen
          connectedPublicKey={connectedWalletPublicKey ?? undefined}
          merchantShortId={activeAccount?.shortId}
          onMerchantTabPress={handleMerchantTabPress}
          onScanPress={() => setCurrentScreen('merchant-scanner')}
          onLogout={handleLogout}
        />
      );
    }

    if (currentScreen === 'merchant-scanner') {
      return (
        <MerchantScannerScreen
          connectedPublicKey={connectedWalletPublicKey ?? undefined}
          merchantShortId={activeAccount?.shortId}
          onMerchantTabPress={handleMerchantTabPress}
          onBackToDashboard={() => setCurrentScreen('merchant-dashboard')}
          onViewHistory={() => setCurrentScreen('merchant-wallet')}
          initialState={merchantScannerState}
          onStateChange={setMerchantScannerState}
          onLogout={handleLogout}
        />
      );
    }

    if (currentScreen === 'merchant-wallet') {
      return (
        <MerchantWalletScreen
          connectedPublicKey={connectedWalletPublicKey ?? undefined}
          merchantShortId={activeAccount?.shortId}
          onMerchantTabPress={handleMerchantTabPress}
          onLogout={handleLogout}
        />
      );
    }

    if (currentScreen === 'lock-funds') {
      return (
        <LockFundsScreen
          connectedPublicKey={connectedWalletPublicKey ?? undefined}
          shortId={activeAccount?.shortId}
          onBack={goToOfflineWallet}
          onDepositComplete={goToOfflineWallet}
        />
      );
    }

    if (currentScreen === 'transaction-status') {
      return <TransactionStatusScreen />;
    }

    return (
      <UnlockFundsScreen
        connectedPublicKey={connectedWalletPublicKey ?? undefined}
        shortId={activeAccount?.shortId}
      />
    );
  }

  function renderBottomBar() {
    if (activeAccount) {
      if (currentScreen === 'online-offline-wallet' || currentScreen === 'offline-wallet') {
        const activeTab = currentScreen === 'online-offline-wallet' ? 'Home' : 'Wallet';
        return (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 24,
              alignItems: 'center',
            }}
          >
            <BottomNavBar active={activeTab} onTabPress={handleBottomTabPress} />
          </View>
        );
      }

      if (currentScreen === 'merchant-dashboard' || currentScreen === 'merchant-scanner' || currentScreen === 'merchant-wallet') {
        let activeTab: MerchantTab = 'Dashboard';
        if (currentScreen === 'merchant-scanner') activeTab = 'Scan';
        if (currentScreen === 'merchant-wallet') activeTab = 'Wallet';
        return (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 24,
              alignItems: 'center',
            }}
          >
            <MerchantBottomNavBar active={activeTab} onTabPress={handleMerchantTabPress} />
          </View>
        );
      }
    }
    return null;
  }

  return (
    <>
      <AnimatedScreenWrapper screenKey={currentScreen}>
        {renderScreen()}
      </AnimatedScreenWrapper>
      {renderBottomBar()}
      <StatusBar style="auto" />

      {/* Logout Confirmation Modal */}
      <Modal
        visible={showLogoutModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
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
                onPress={() => setShowLogoutModal(false)}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonConfirm,
                  pressed && styles.pressed,
                ]}
                onPress={confirmLogout}
              >
                <Text style={styles.modalButtonConfirmText}>Log Out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
