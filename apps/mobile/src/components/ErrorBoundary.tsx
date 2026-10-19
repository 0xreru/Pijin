import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from './ui/AppButton';
import { reportError } from '../services/errorReporting';

type Props = { children: React.ReactNode };
type State = { error: Error | null; resetKey: number };

/**
 * Catches render/lifecycle errors anywhere below it and shows a recovery screen
 * instead of a blank app. "Try again" remounts the tree; wallet keys and the
 * offline queue live in SecureStore/SQLite, so nothing is lost.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportError(error, { source: 'ErrorBoundary', componentStack: info.componentStack });
  }

  private handleReset = () => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  render() {
    const { error, resetKey } = this.state;

    if (error) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.content} accessibilityRole="alert">
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.body}>
              Pijin hit an unexpected problem. Your wallet and any offline payments are safe on this device.
            </Text>
            {__DEV__ && (
              <ScrollView style={styles.devBox}>
                <Text style={styles.devText}>{error.message}</Text>
              </ScrollView>
            )}
            <AppButton title="Try again" onPress={this.handleReset} style={styles.button} />
          </View>
        </SafeAreaView>
      );
    }

    return <React.Fragment key={resetKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111111',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#4B5563',
  },
  devBox: {
    maxHeight: 160,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 12,
  },
  devText: {
    fontSize: 12,
    color: '#B91C1C',
  },
  button: {
    marginTop: 12,
  },
});
