import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function OfflineNoticeModal({ visible, onClose }: Props) {
  const [dontRemind, setDontRemind] = useState(false);

  const handleUnderstand = async () => {
    if (dontRemind) {
      await AsyncStorage.setItem('pijn.hide_offline_notice', 'true');
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <Image
            source={require('../../../assets/home/pijin-offline-modal.png')}
            style={styles.mascotImage}
            contentFit="contain"
          />
          
          <Text style={styles.title}>No Internet Connection</Text>
          <Text style={styles.description}>
            You are currently offline. Online features are disabled, but you can still access your offline vault and perform offline transactions securely.
          </Text>

          <TouchableOpacity
            style={styles.checkboxContainer}
            activeOpacity={0.7}
            onPress={() => setDontRemind(!dontRemind)}
          >
            <Ionicons
              name={dontRemind ? 'checkbox' : 'square-outline'}
              size={24}
              color={dontRemind ? '#031634' : '#9CA3AF'}
            />
            <Text style={styles.checkboxText}>Do not remind me again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.button}
            activeOpacity={0.8}
            onPress={handleUnderstand}
          >
            <Text style={styles.buttonText}>I understand</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(3, 22, 52, 0.75)', // Deep blue overlay matching the theme
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#031634',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  mascotImage: {
    width: SCREEN_WIDTH * 0.45,
    height: SCREEN_WIDTH * 0.35,
    marginVertical: 5,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#031634',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  description: {
    fontSize: 15,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    width: '100%',
  },
  checkboxText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#031634',
    marginLeft: 12,
  },
  button: {
    backgroundColor: '#031634', // Deep blue button to match the branding
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#031634',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
