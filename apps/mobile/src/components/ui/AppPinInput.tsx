import React, { useRef } from 'react';
import { StyleSheet, TextInput, View, NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';

interface AppPinInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  theme?: 'light' | 'dark';
  secureTextEntry?: boolean;
  /** Override box size (width & height) for layouts with many digits. Default: 60. */
  inputSize?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}

export function AppPinInput({
  value,
  onChange,
  length = 4,
  theme = 'light',
  secureTextEntry = false,
  inputSize = 60,
  onFocus,
  onBlur,
}: AppPinInputProps) {
  const inputs = useRef<Array<TextInput | null>>([]);

  const handleChangeText = (text: string, index: number) => {
    // Only allow numeric input
    const cleanText = text.replace(/[^0-9]/g, '');
    const currentCode = value.split('');
    currentCode[index] = cleanText;
    const newCode = currentCode.join('');
    
    onChange(newCode);

    // Auto-focus next box if filled
    if (cleanText && index < length - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) => {
    if (e.nativeEvent.key === 'Backspace') {
      const currentCode = value.split('');
      if (!currentCode[index] && index > 0) {
        // Current is empty, focus previous and clear it
        inputs.current[index - 1]?.focus();
        currentCode[index - 1] = '';
        onChange(currentCode.join(''));
      }
    }
  };

  const codeArray = value.padEnd(length, ' ').split('').slice(0, length);
  const isDark = theme === 'dark';

  return (
    <View style={styles.container}>
      {codeArray.map((char, index) => (
        <TextInput
          key={index}
          ref={(ref) => {
            inputs.current[index] = ref;
          }}
          style={[
            styles.input,
            { width: inputSize, height: inputSize + 12 },
            isDark ? styles.darkInput : styles.lightInput,
            value.length === index && styles.activeInput,
          ]}
          value={char.trim()}
          onChangeText={(text) => handleChangeText(text, index)}
          onKeyPress={(e) => handleKeyPress(e, index)}
          keyboardType="numeric"
          maxLength={1}
          secureTextEntry={secureTextEntry}
          selectTextOnFocus
          onFocus={onFocus}
          onBlur={onBlur}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 20,
    width: '100%',
  },
  input: {
    // width & height are overridden inline via inputSize prop
    borderRadius: 8,
    borderWidth: 1.5,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  lightInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#031634',
    color: '#08090A',
  },
  darkInput: {
    backgroundColor: 'transparent',
    borderColor: '#FFFFFF',
    color: '#FFFFFF',
  },
  activeInput: {
    borderColor: '#635BFF',
  },
});
