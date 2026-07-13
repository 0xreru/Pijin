import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getUserPin, saveUserPin, saveUserPinSecure } from '../services/storage/onboardingStorage';

const KEYPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'backspace'],
];

export function ChangePinScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  
  const [step, setStep] = useState<'verify' | 'new' | 'confirm'>('verify');
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');

  const handleKeyPress = (key: string) => {
    if (pin.length >= 4) return;
    const nextPin = pin + key;
    setPin(nextPin);
    
    if (nextPin.length === 4) {
      setTimeout(() => {
        processPin(nextPin);
      }, 150);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const processPin = async (enteredPin: string) => {
    if (step === 'verify') {
      const currentPin = await getUserPin();
      if (enteredPin === currentPin) {
        setStep('new');
        setPin('');
      } else {
        Alert.alert('Error', 'Incorrect current PIN.');
        setPin('');
      }
    } else if (step === 'new') {
      setNewPin(enteredPin);
      setStep('confirm');
      setPin('');
    } else if (step === 'confirm') {
      if (enteredPin === newPin) {
        await saveUserPin(enteredPin);
        await saveUserPinSecure(enteredPin);
        Alert.alert('Success', 'PIN successfully changed.', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      } else {
        Alert.alert('Error', 'PINs do not match. Try again.');
        setStep('new');
        setPin('');
        setNewPin('');
      }
    }
  };

  const renderTitle = () => {
    if (step === 'verify') return 'Enter Current MPIN';
    if (step === 'new') return 'Enter New MPIN';
    return 'Confirm New MPIN';
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
      <StatusBar barStyle="light-content" />
      
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-undo-outline" size={28} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change MPIN</Text>
      </View>

      <View style={styles.topContainer}>
        <Text style={styles.enterMpinText}>{renderTitle()}</Text>
        <View style={styles.dotsContainer}>
          {[0, 1, 2, 3].map((index) => {
            const isFilled = pin.length > index;
            return (
              <View
                key={index}
                style={[
                  styles.pinDot,
                  isFilled ? styles.pinDotFilled : styles.pinDotEmpty,
                ]}
              />
            );
          })}
        </View>
      </View>

      <View style={[styles.keyboardContainer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.keypadGrid}>
          {KEYPAD.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.keyboardRow}>
              {row.map((key, colIndex) => {
                if (key === '') {
                  return <View key={colIndex} style={styles.keyButtonPlaceholder} />;
                }
                if (key === 'backspace') {
                  return (
                    <TouchableOpacity
                      key={colIndex}
                      style={styles.keyButton}
                      onPress={handleBackspace}
                      activeOpacity={0.6}
                    >
                      <Ionicons name="backspace-outline" size={28} color="#031634" />
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity
                    key={colIndex}
                    style={styles.keyButton}
                    onPress={() => handleKeyPress(key)}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.keyText}>{key}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#031634', justifyContent: 'space-between' },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 20 },
  backButton: { marginRight: 15 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#FFF' },
  topContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  enterMpinText: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', marginBottom: 20 },
  dotsContainer: { flexDirection: 'row', justifyContent: 'center', gap: 20 },
  pinDot: { width: 16, height: 16, borderRadius: 8 },
  pinDotEmpty: { borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'transparent' },
  pinDotFilled: { backgroundColor: '#FFFFFF' },
  keyboardContainer: { backgroundColor: '#EDEDED', paddingTop: 24, borderTopWidth: 1, borderColor: '#E5E7EB' },
  keypadGrid: { width: '100%', paddingHorizontal: 48, gap: 8 },
  keyboardRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  keyButton: { width: 64, height: 64, justifyContent: 'center', alignItems: 'center' },
  keyButtonPlaceholder: { width: 64, height: 64 },
  keyText: { fontSize: 32, fontWeight: '400', color: '#031634' },
});
