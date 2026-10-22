import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { runMigrations } from './src/db/migrations';
import { syncService } from './src/services/syncService';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ensureMigration } from './src/services/storage/migration';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { installGlobalErrorHandler, reportError } from './src/services/errorReporting';
import { PlaceholderScreen } from './src/screens/PlaceholderScreen';

installGlobalErrorHandler();

type DbStatus = 'pending' | 'ready' | 'error';

/**
 * v2 route map. Add screens here as they are built.
 * Logic lives in src/features/* hooks and src/services/*; screens should stay thin.
 */
export type RootStackParamList = {
  Placeholder: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Placeholder" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Placeholder" component={PlaceholderScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function AppContent({ dbStatus, onRetryDb }: { dbStatus: DbStatus; onRetryDb: () => void }) {
  const { isAppReady } = useAuth();

  if (dbStatus === 'error') {
    return (
      <View style={styles.center} accessibilityRole="alert">
        <Text style={styles.title}>HoneBill couldn't start</Text>
        <Text style={styles.text}>Local storage failed to open. Your wallet is safe, please try again.</Text>
        <Pressable accessibilityRole="button" onPress={onRetryDb} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (dbStatus !== 'ready' || !isAppReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#111111" />
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
  const isMountedRef = useRef(true);
  const [dbStatus, setDbStatus] = useState<DbStatus>('pending');
  const [dbAttempt, setDbAttempt] = useState(0);

  // Storage migration, then SQLite migrations, then the sync service, in that
  // order. Both migrations are idempotent, so retrying is safe.
  useEffect(() => {
    isMountedRef.current = true;
    setDbStatus('pending');

    const init = async () => {
      try {
        await ensureMigration();
        await runMigrations();
        if (!isMountedRef.current) return;
        setDbStatus('ready');
        syncService.start();
      } catch (err) {
        reportError(err, { source: 'App.init', attempt: dbAttempt });
        if (isMountedRef.current) setDbStatus('error');
      }
    };
    init();

    return () => {
      isMountedRef.current = false;
      syncService.stop();
    };
  }, [dbAttempt]);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <AppContent dbStatus={dbStatus} onRetryDb={() => setDbAttempt((n) => n + 1)} />
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: 12 },
  title: { color: '#111111', fontSize: 20, fontWeight: '700' },
  text: { color: '#4B5563', fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  button: { marginTop: 8, minWidth: 160, backgroundColor: '#111111', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
