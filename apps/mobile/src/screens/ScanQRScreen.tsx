import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Dimensions,
  Image,
  Animated,
  StatusBar,
  Alert,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';
import { ensureMigration } from '../services/storage/migration';
import { enqueuePayment } from '../db/services/paymentQueueDb';
import { OfflinePaymentPayload } from '../types/payment';
import { useAuth } from '../context/AuthContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const VIEWFINDER_SIZE = SCREEN_WIDTH * 0.82;

export function ScanQRScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { activeAccount } = useAuth();
  const isFocused = useIsFocused();
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const checkState = async () => {
      await ensureMigration();
      const val = await AsyncStorage.getItem('pijn.is_online');
      setIsOnline(val !== 'false');
    };
    checkState();
  }, []);
  
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const laserAnim = useRef(new Animated.Value(0)).current;

  // Reset scanned status when screen gains focus
  useEffect(() => {
    if (isFocused) {
      setScanned(false);
    }
  }, [isFocused]);

  // Laser scanning animation
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(laserAnim, {
          toValue: VIEWFINDER_SIZE - 30,
          duration: 2500,
          useNativeDriver: false,
        }),
        Animated.timing(laserAnim, {
          toValue: 0,
          duration: 2500,
          useNativeDriver: false,
        }),
      ])
    );
    
    animation.start();
    return () => animation.stop();
  }, []);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned || !isFocused) return;
    setScanned(true);

    const parts = data.split(':');
    if (parts.length === 5) {
      // Signed offline voucher (customerShortId:merchantShortId:amountPhp:nonceB64:signatureB64)
      try {
        const { parseOfflinePaymentPayload } = require('../utils/offlinePaymentPayload');
        const parsed = parseOfflinePaymentPayload(data);
        
        const { addTransaction } = require('../db/services/transactionDb');
        await addTransaction({
          title: `Scanned Payment from ${parsed.customerShortId}`,
          amount: parsed.amount,
          type: 'incoming',
          tag: 'OFFLINE',
          description: `Scanned offline payment of ₱${parsed.amount} from customer ${parsed.customerShortId}. Awaiting sync to Stellar network.`,
          stellarPublicKey: activeAccount?.stellarPublicKey,
          shortId: activeAccount?.shortId,
        });

        await enqueuePayment(parsed);

        Alert.alert(
          'Relay Voucher Scanned',
          `Successfully scanned offline payment of ₱${parsed.amount} from customer ${parsed.customerShortId}. It has been added to your queue and will sync to the Stellar network.`,
          [{ text: 'OK', onPress: () => navigation.navigate('Dashboard') }]
        );
      } catch (err: any) {
        setScanned(false);
        Alert.alert('Scan Error', err.message || 'Invalid signed voucher scanned.');
      }
    } else {
      // Receiver Short ID or standard prefilled format
      if (data.includes(':')) {
        navigation.navigate('SendMoney', { qrData: data, isScanned: true });
      } else {
        navigation.navigate('SendMoney', { recipientShortId: data, isScanned: true });
      }
    }
  };

  const handleSimulatorScanTap = async () => {
    await ensureMigration();
    const isOnlineStr = await AsyncStorage.getItem('pijn.is_online');
    const isAppOnline = isOnlineStr !== 'false';
    if (isAppOnline) {
      handleBarCodeScanned({ data: '09171234567:150.00:Dinner at Jollibee' });
    } else {
      handleBarCodeScanned({ data: '9999:150.00:Offline Merchant Dinner' });
    }
  };

  const renderCameraContent = () => {
    if (!permission) {
      // Camera permissions are still loading
      return <ActivityIndicator size="large" color="#FFFFFF" />;
    }

    if (!permission.granted) {
      // Camera permissions are not granted yet
      return (
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={40} color="#FFFFFF" style={{ marginBottom: 12 }} />
          <Text style={styles.permissionText}>Camera Access Required</Text>
          <TouchableOpacity 
            style={styles.permissionBtn} 
            onPress={requestPermission}
            activeOpacity={0.8}
          >
            <Text style={styles.permissionBtnText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={handleBarCodeScanned}
      />
    );
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20) }]}>
      <StatusBar barStyle="dark-content" />

      <ConnectionWatcher navigation={navigation} currentMode={isOnline ? 'online' : 'offline'} />

      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-undo-outline" size={28} color="#000000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan the QR Code</Text>
      </View>

      {/* Viewfinder Section */}
      <View style={styles.viewfinderContainer}>
        {/* Tapping this acts as simulator fallback trigger */}
        <TouchableOpacity
          activeOpacity={1}
          style={styles.viewfinderFrame}
          onPress={handleSimulatorScanTap}
        >
          {renderCameraContent()}

          {/* Corner Brackets */}
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />

          {/* Animated Laser Line */}
          {permission?.granted && (
            <Animated.View
              style={[
                styles.laserLine,
                {
                  transform: [{ translateY: laserAnim }],
                },
              ]}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Instructions */}
      <Text style={styles.instructionText}>
        Point your camera at the QR code to scan.
      </Text>

      {/* Generate QR Button */}
      <TouchableOpacity
        style={styles.generateQrButton}
        onPress={() => navigation.navigate('GenerateQR', { mode: 'receiver' })}
        activeOpacity={0.8}
      >
        <Ionicons name="qr-code-outline" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
        <Text style={styles.generateQrButtonText}>Generate QR</Text>
      </TouchableOpacity>

      {/* Mascot Image */}
      <View style={styles.mascotContainer}>
        <Image
          source={require('../../assets/qr scanning/piji-qr.png')}
          style={styles.mascotImage}
          resizeMode="contain"
        />
      </View>

      {/* Footer */}
      <View style={[styles.footerContainer, { paddingBottom: Math.max(insets.bottom, 15) }]}>
        <Text style={styles.pijinLogo}>p i j i n</Text>
        <TouchableOpacity onPress={() => Alert.alert('Help', 'Support information')} activeOpacity={0.7}>
          <Text style={styles.getHelpLink}>Get help</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EFF1F5',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 15,
    marginBottom: 10,
  },
  backButton: {
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#000000',
  },
  viewfinderContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  viewfinderFrame: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    backgroundColor: '#000000',
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderColor: '#FFFFFF',
  },
  topLeft: {
    top: 18,
    left: 18,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 8,
  },
  topRight: {
    top: 18,
    right: 18,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 8,
  },
  bottomLeft: {
    bottom: 18,
    left: 18,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 8,
  },
  bottomRight: {
    bottom: 18,
    right: 18,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 8,
  },
  laserLine: {
    position: 'absolute',
    left: 25,
    right: 25,
    height: 2.5,
    backgroundColor: '#3B82F6',
    top: 15,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
  },
  permissionContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  permissionBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  instructionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8C98A6',
    textAlign: 'center',
    marginBottom: 20,
  },
  mascotContainer: {
    flex: 1,
    width: '100%',
    top: 30,
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
  },
  mascotImage: {
    width: SCREEN_WIDTH * 0.9,
    height: '100%',
  },
  footerContainer: {
    borderTopWidth: 1,
    borderTopColor: '#D1D5DB',
    width: '100%',
    paddingTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  pijinLogo: {
    fontSize: 24,
    fontWeight: '800',
    color: '#04295A',
    letterSpacing: 8,
    marginBottom: 8,
  },
  getHelpLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#04295A',
    textDecorationLine: 'underline',
  },
  generateQrButton: {
    backgroundColor: '#04295A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
    marginTop: 10,
    alignSelf: 'center',
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  generateQrButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
