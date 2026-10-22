import { StyleSheet, Text, View } from 'react-native';

/** Temporary landing screen for the clean slate. Delete once the v2 entry screen exists. */
export function PlaceholderScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>HoneBill</Text>
      <Text style={styles.subtitle}>v2 UI goes here</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  title: { fontSize: 28, fontWeight: '800', color: '#111111' },
  subtitle: { marginTop: 8, fontSize: 14, color: '#6B7280' },
});
