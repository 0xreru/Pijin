import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function ScannerHeader() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>ScannerHeader Component</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 14,
    color: '#374151',
  },
});
