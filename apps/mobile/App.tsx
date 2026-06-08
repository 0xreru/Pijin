import { useState, useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { OnboardingScreen, DashboardScreen, SignInScreen } from './src/screens';
import { isOnboardingComplete } from './src/services/storage/onboardingStorage';

type RootStackParamList = {
  Onboarding: { initialStep?: number } | undefined;
  SignIn: undefined;
  Dashboard: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator({ initialRoute }: { initialRoute: keyof RootStackParamList }) {
  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="SignIn" component={SignInScreen} />
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
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
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      try {
        const complete = await isOnboardingComplete();
        setInitialRoute(complete ? 'SignIn' : 'Onboarding');
      } catch (err) {
        console.error('Failed to load onboarding status:', err);
        setInitialRoute('Onboarding');
      }
    };

    if (isAppReady) {
      checkOnboardingStatus();
    }
  }, [isAppReady]);

  if (!isAppReady || (!fontsLoaded && !fontError && !fontLoadTimedOut) || !initialRoute) {
    return (
      <View style={styles.splashContainer}>
        <ActivityIndicator size="large" color="#111111" />
        <Text style={styles.splashText}>Starting...</Text>
      </View>
    );
  }

  return (
    <>
      <RootNavigator initialRoute={initialRoute} />
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
