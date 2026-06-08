import React from 'react';
import { StyleSheet, View, ViewStyle, TouchableOpacity } from 'react-native';

interface AppCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}

export function AppCard({ children, style, onPress }: AppCardProps) {
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={[styles.card, style]}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#031634',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#EBF0F5',
  },
});

