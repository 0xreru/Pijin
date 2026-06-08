import React from 'react';
import { StyleSheet, Text, View, SafeAreaView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { AppButton } from '../components/ui/AppButton';
import { clearOnboardingData } from '../services/storage/onboardingStorage';

export function DashboardScreen() {
  const handleReset = async () => {
    try {
      await clearOnboardingData();
      alert('Onboarding status reset successfully. Please reload/restart the app.');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.logo}>pijin</Text>
        
        <View style={styles.content}>
          <Text style={styles.title}>Home Dashboard</Text>
          <Text style={styles.subtitle}>
            Welcome to Pijin! You have successfully completed the onboarding flow and secured your device vault.
          </Text>
        </View>

        <View style={styles.footer}>
          <AppButton
            title="Reset Onboarding Status"
            onPress={handleReset}
            variant="secondary"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: {
    fontSize: 28,
    fontWeight: '900',
    color: '#08090A',
    marginTop: 20,
    letterSpacing: -0.5,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#08090A',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#707984',
    textAlign: 'center',
  },
  footer: {
    width: '100%',
    marginBottom: 20,
  },
});
