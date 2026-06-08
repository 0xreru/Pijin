import { useState, useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

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
  MerchantDashboard: undefined;
  MerchantScanner: undefined;
  MerchantWallet: undefined;
  OnlineOfflineWallet: undefined;
  OfflineWallet: undefined;
  PayAmount: undefined;
  QrVoucher: undefined;
  LockFunds: undefined;
  UnlockFunds: undefined;
  TransactionStatus: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer>
        <Stack.Navigator 
          initialRouteName="Onboarding" 
          screenOptions={{ 
            headerShown: true, 
            animation: 'slide_from_right' 
          }}
        >
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="CustomerOnline" component={CustomerOnlineScreen} />
          <Stack.Screen name="WalletSetup" component={WalletSetupScreen} />
          <Stack.Screen name="MerchantSetup" component={MerchantSetupScreen} />
          <Stack.Screen name="MerchantDashboard" component={MerchantDashboardScreen} />
          <Stack.Screen name="MerchantScanner" component={MerchantScannerScreen} />
          <Stack.Screen name="MerchantWallet" component={MerchantWalletScreen} />
          <Stack.Screen name="OnlineOfflineWallet" component={OnlineOfflineWalletScreen} />
          <Stack.Screen name="OfflineWallet" component={OfflineWalletScreen} />
          <Stack.Screen name="PayAmount" component={PayAmountScreen} />
          <Stack.Screen name="QrVoucher" component={QRVoucherScreen} />
          <Stack.Screen name="LockFunds" component={LockFundsScreen} />
          <Stack.Screen name="UnlockFunds" component={UnlockFundsScreen} />
          <Stack.Screen name="TransactionStatus" component={TransactionStatusScreen} />
        </Stack.Navigator>
      </NavigationContainer>
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
        <Text style={styles.splashText}>Starting...</Text>
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
