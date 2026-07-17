import React from 'react';
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function OfflineSuccessModal({ visible, onClose }: Props) {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <View style={styles.iconContainer}>
            <Ionicons name="checkmark-circle" size={56} color="#10B981" />
          </View>
          
          <Image
            source={require('../../../assets/success/piji-success.png')}
            style={styles.mascotImage}
            contentFit="contain"
          />
          
          <Text style={styles.title}>Offline Transaction Saved</Text>
          
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={24} color="#031634" style={styles.infoIcon} />
            <Text style={styles.description}>
              Your local balance has been updated. If the SMS relay fails for any reason, <Text style={styles.boldText}>your funds are safe</Text>. 
              {"\n\n"}
              Your true balance and history will automatically correct themselves the next time you connect to the internet.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.button}
            activeOpacity={0.8}
            onPress={onClose}
          >
            <Text style={styles.buttonText}>I Understand</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(3, 22, 52, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 24,
    paddingTop: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#031634',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    position: 'relative',
  },
  iconContainer: {
    position: 'absolute',
    top: -28,
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    padding: 2,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  mascotImage: {
    width: SCREEN_WIDTH * 0.40,
    height: SCREEN_WIDTH * 0.30,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#031634',
    marginBottom: 20,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  infoBox: {
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    padding: 16,
    marginBottom: 28,
    width: '100%',
    flexDirection: 'row',
  },
  infoIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  description: {
    flex: 1,
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 22,
  },
  boldText: {
    fontWeight: '700',
    color: '#031634',
  },
  button: {
    backgroundColor: '#031634',
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
