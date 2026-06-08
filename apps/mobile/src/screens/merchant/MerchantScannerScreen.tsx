import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function MerchantScannerScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>MerchantScannerScreen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  text: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111111',
  },
});
