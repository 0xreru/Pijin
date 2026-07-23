import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Modal, Dimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';

interface ErrorModalProps {
  visible: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
  primaryButtonText?: string;
  variant?: 'error' | 'success';
}

export function ErrorModal({
  visible,
  title,
  message,
  onDismiss,
  primaryButtonText,
  variant = 'error',
}: ErrorModalProps) {
  const isSuccess = variant === 'success';
  const buttonText = primaryButtonText || (isSuccess ? 'Dismiss' : 'Dismiss & Try Again');
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <TouchableOpacity onPress={onDismiss} style={styles.closeModalButton} activeOpacity={0.7}>
            <Ionicons name="close-outline" size={24} color="#6B7280" />
          </TouchableOpacity>
          
          <View style={styles.errorIconContainer}>
            <Image
              source={isSuccess ? require('../../../assets/modals/piji-success.png') : require('../../../assets/modals/piji-error.png')}
              style={styles.mascotImage}
              contentFit="contain"
            />
          </View>

          <Text style={styles.errorTitle}>{title}</Text>
          <Text style={styles.errorDesc}>{message}</Text>

          <TouchableOpacity 
            onPress={onDismiss} 
            style={styles.errorDismissButton} 
            activeOpacity={0.9}
          >
            <Text style={styles.errorDismissButtonText}>{buttonText}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_SIZE = SCREEN_WIDTH * 0.55;

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    zIndex: 9999,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    width: '100%',
    padding: 24,
    paddingVertical: 32,
    alignItems: 'center',
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
  },
  closeModalButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10,
  },
  errorIconContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  mascotImage: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#04295A',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorDesc: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 16,
  },
  errorDismissButton: {
    backgroundColor: '#04295A',
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  },
  errorDismissButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
