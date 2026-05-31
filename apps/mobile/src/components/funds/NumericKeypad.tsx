import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors } from '../../constants/theme';
import { KeypadKey } from '../../types/funds';

const keys: KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'];

type NumericKeypadProps = {
  onPressKey: (key: KeypadKey) => void;
};

export function NumericKeypad({ onPressKey }: NumericKeypadProps) {
  return (
    <View style={styles.grid}>
      {keys.map((key) => (
        <Pressable key={key} onPress={() => onPressKey(key)} style={({ pressed }) => [styles.key, pressed && styles.pressed]}>
          {key === 'backspace' ? <BackspaceIcon /> : <Text style={styles.keyText}>{key}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

function BackspaceIcon() {
  return <Ionicons name="backspace-outline" size={31} color={colors.mutedDark} />;
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 34,
  },
  key: {
    width: '31%',
    height: 45,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  keyText: {
    fontSize: 29,
    lineHeight: 34,
    fontWeight: '800',
    color: colors.mutedDark,
  },
});
