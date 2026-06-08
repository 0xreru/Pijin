import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function OnlineOfflineWalletScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>OnlineOfflineWalletScreen</Text>
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
