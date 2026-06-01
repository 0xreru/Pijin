import { useState, useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { colors } from './src/constants/theme';
import { BottomNavBar, BottomTab } from './src/components/ui/BottomNavBar';
import { MerchantBottomNavBar, MerchantTab } from './src/components/ui/MerchantBottomNavBar';
import { LogoutConfirmationModal } from './src/components/ui/LogoutConfirmationModal';
import { AuthProvider, useAuth } from './src/context/AuthContext';

import {
  OnboardingScreen,
  CustomerOnlineScreen,
  WalletSetupScreen,
  OnlineOfflineWalletScreen,
  OfflineWalletScreen,
  LockFundsScreen,
  TransactionStatusScreen,
  UnlockFundsScreen,
  PayAmountScreen,
  QRVoucherScreen,
  MerchantSetupScreen,
  MerchantDashboardScreen,
  MerchantScannerScreen,
  MerchantWalletScreen,
} from './src/screens';

type RootStackParamList = {
  Onboarding: undefined;
  CustomerOnline: undefined;
  WalletSetup: undefined;
  MerchantSetup: undefined;

  // Customer
  OnlineOfflineWallet: undefined;
  OfflineWallet: undefined;
  PayAmount: undefined;
  QrVoucher: { amount: number; merchantShortId?: string };
  LockFunds: undefined;
  UnlockFunds: undefined;
  TransactionStatus: undefined;

  // Merchant
  MerchantDashboard: undefined;
  MerchantScanner: { initialState?: 'idle' | 'scanner' } | undefined;
  MerchantWallet: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const { activeAccount, connectedWalletPublicKey, userMode, login, setUserMode, logout } = useAuth();
  const [merchantScannerState, setMerchantScannerState] = useState<'idle' | 'scanner'>('scanner');
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const insets = useSafeAreaInsets();

  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [currentRouteName, setCurrentRouteName] = useState<keyof RootStackParamList | undefined>(undefined);

  function handleBottomTabPress(tab: BottomTab) {
    if (tab === 'Home') {
      navigationRef.navigate('OnlineOfflineWallet');
    } else if (tab === 'Pay') {
      navigationRef.navigate('PayAmount');
    } else if (tab === 'Wallet') {
      navigationRef.navigate('OfflineWallet');
    }
  }

  function handleMerchantTabPress(tab: MerchantTab) {
    if (tab === 'Dashboard') {
      navigationRef.navigate('MerchantDashboard');
    } else if (tab === 'Scan') {
      navigationRef.navigate('MerchantScanner', { initialState: 'scanner' });
    } else if (tab === 'Wallet') {
      navigationRef.navigate('MerchantWallet');
    }
  }

  function renderBottomBar() {
    if (!activeAccount) return null;

    const showCustomerBar = currentRouteName === 'OnlineOfflineWallet' || currentRouteName === 'OfflineWallet';
    const showMerchantBar = currentRouteName === 'MerchantDashboard' || currentRouteName === 'MerchantScanner' || currentRouteName === 'MerchantWallet';

    if (showCustomerBar) {
      const activeTab: BottomTab = currentRouteName === 'OnlineOfflineWallet' ? 'Home' : 'Wallet';
      return (
        <View
          style={[
            styles.bottomBarContainer,
            { bottom: Math.max(insets.bottom, 16) }
          ]}
        >
          <BottomNavBar active={activeTab} onTabPress={handleBottomTabPress} />
        </View>
      );
    }

    if (showMerchantBar) {
      let activeTab: MerchantTab = 'Dashboard';
      if (currentRouteName === 'MerchantScanner') activeTab = 'Scan';
      if (currentRouteName === 'MerchantWallet') activeTab = 'Wallet';
      return (
        <View
          style={[
            styles.bottomBarContainer,
            { bottom: Math.max(insets.bottom, 16) }
          ]}
        >
          <MerchantBottomNavBar active={activeTab} onTabPress={handleMerchantTabPress} />
        </View>
      );
    }

    return null;
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer
        ref={navigationRef}
        onStateChange={() => {
          setCurrentRouteName(navigationRef.getCurrentRoute()?.name as keyof RootStackParamList);
        }}
      >
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
          {!activeAccount ? (
            <>
              <Stack.Screen name="Onboarding">
                {(props) => (
                  <OnboardingScreen
                    onFinish={() => props.navigation.navigate('CustomerOnline')}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="CustomerOnline">
                {(props) => (
                  <CustomerOnlineScreen
                    onContinue={(mode) => {
                      setUserMode(mode);
                      props.navigation.navigate(mode === 'merchant' ? 'MerchantSetup' : 'WalletSetup');
                    }}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="MerchantSetup">
                {(props) => (
                  <MerchantSetupScreen
                    onBack={() => props.navigation.navigate('CustomerOnline')}
                    onRegistered={async (publicKey, shortId) => {
                      await login(publicKey, shortId, 'MERCHANT');
                    }}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="WalletSetup">
                {(props) => (
                  <WalletSetupScreen
                    userMode={userMode}
                    onBack={() => props.navigation.navigate('CustomerOnline')}
                    onWalletConnected={async (publicKey, shortId) => {
                      const role = userMode === 'merchant' ? 'MERCHANT' : 'CUSTOMER';
                      await login(publicKey, shortId, role);
                    }}
                  />
                )}
              </Stack.Screen>
            </>
          ) : activeAccount.role === 'MERCHANT' ? (
            <>
              <Stack.Screen name="MerchantWallet">
                {() => (
                  <MerchantWalletScreen
                    connectedPublicKey={connectedWalletPublicKey ?? undefined}
                    merchantShortId={activeAccount.shortId}
                    onMerchantTabPress={handleMerchantTabPress}
                    onLogout={() => setShowLogoutModal(true)}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="MerchantDashboard">
                {() => (
                  <MerchantDashboardScreen
                    connectedPublicKey={connectedWalletPublicKey ?? undefined}
                    merchantShortId={activeAccount.shortId}
                    onMerchantTabPress={handleMerchantTabPress}
                    onScanPress={() => navigationRef.navigate('MerchantScanner', { initialState: 'scanner' })}
                    onLogout={() => setShowLogoutModal(true)}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="MerchantScanner">
                {(props) => {
                  const initialState = props.route.params?.initialState || merchantScannerState;
                  return (
                    <MerchantScannerScreen
                      connectedPublicKey={connectedWalletPublicKey ?? undefined}
                      merchantShortId={activeAccount.shortId}
                      onMerchantTabPress={handleMerchantTabPress}
                      onBackToDashboard={() => navigationRef.navigate('MerchantDashboard')}
                      onViewHistory={() => navigationRef.navigate('MerchantWallet')}
                      initialState={initialState}
                      onStateChange={setMerchantScannerState}
                      onLogout={() => setShowLogoutModal(true)}
                    />
                  );
                }}
              </Stack.Screen>
            </>
          ) : (
            <>
              <Stack.Screen name="OnlineOfflineWallet">
                {() => (
                  <OnlineOfflineWalletScreen
                    bottomTab="Home"
                    connectedPublicKey={connectedWalletPublicKey ?? undefined}
                    shortId={activeAccount.shortId}
                    onBottomTabPress={handleBottomTabPress}
                    onLogout={() => setShowLogoutModal(true)}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="OfflineWallet">
                {() => (
                  <OfflineWalletScreen
                    bottomTab="Wallet"
                    connectedPublicKey={connectedWalletPublicKey ?? undefined}
                    shortId={activeAccount.shortId}
                    onBottomTabPress={handleBottomTabPress}
                    onPrepareOfflineCash={() => navigationRef.navigate('LockFunds')}
                    onLogout={() => setShowLogoutModal(true)}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="PayAmount">
                {() => (
                  <PayAmountScreen
                    connectedPublicKey={connectedWalletPublicKey ?? undefined}
                    onBack={() => navigationRef.navigate('OfflineWallet')}
                    onGenerateQr={(amount) => navigationRef.navigate('QrVoucher', { amount })}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="QrVoucher">
                {(props) => {
                  const amount = props.route.params?.amount ?? 0;
                  return (
                    <QRVoucherScreen
                      amount={amount}
                      customerPublicKey={connectedWalletPublicKey ?? undefined}
                      customerShortId={activeAccount.shortId}
                      merchantShortId="M-DEMO"
                      onCancel={() => navigationRef.navigate('PayAmount')}
                    />
                  );
                }}
              </Stack.Screen>
              <Stack.Screen name="LockFunds">
                {() => (
                  <LockFundsScreen
                    connectedPublicKey={connectedWalletPublicKey ?? undefined}
                    shortId={activeAccount.shortId}
                    onBack={() => navigationRef.navigate('OfflineWallet')}
                    onDepositComplete={() => navigationRef.navigate('OfflineWallet')}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="TransactionStatus">
                {() => <TransactionStatusScreen />}
              </Stack.Screen>
              <Stack.Screen name="UnlockFunds">
                {() => (
                  <UnlockFundsScreen
                    connectedPublicKey={connectedWalletPublicKey ?? undefined}
                    shortId={activeAccount.shortId}
                  />
                )}
              </Stack.Screen>
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {renderBottomBar()}
      <LogoutConfirmationModal
        visible={showLogoutModal}
        onCancel={() => setShowLogoutModal(false)}
        onConfirm={async () => {
          setShowLogoutModal(false);
          await logout();
        }}
      />
    </View>
  );
}

function AppContent({
  fontsLoaded,
  fontError,
  fontLoadTimedOut,
}: {
  fontsLoaded: boolean;
  fontError: any;
  fontLoadTimedOut: boolean;
}) {
  const { isAppReady } = useAuth();

  if (!isAppReady || (!fontsLoaded && !fontError && !fontLoadTimedOut)) {
    return (
      <View style={styles.splashContainer}>
        <ActivityIndicator size="large" color="#111111" />
        <Text style={styles.splashText}>Starting AbotPera...</Text>
      </View>
    );
  }

  return (
    <>
      <RootNavigator />
      <StatusBar style="auto" />
    </>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  const [fontLoadTimedOut, setFontLoadTimedOut] = useState(false);

  useEffect(() => {
    if (fontError) {
      console.error('Failed to load Ionicons font:', fontError);
    }
  }, [fontError]);

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

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppContent
          fontsLoaded={fontsLoaded}
          fontError={fontError}
          fontLoadTimedOut={fontLoadTimedOut}
        />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  bottomBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  splashContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  splashText: {
    color: '#4B5563',
    fontSize: 14,
  },
});
