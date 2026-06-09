import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

interface ScanTabProps {
  insets: { top: number; bottom: number; left: number; right: number };
}

export function ScanTab({ insets }: ScanTabProps) {
  return (
    <View style={[styles.scannerContainer, { paddingTop: Math.max(insets.top, 20) }]}>
      <Text style={styles.tabHeaderTitleCentered}>Scan QR Code</Text>
      <Text style={styles.scannerSubtitle}>Position the QR code within the frame to pay offline</Text>
      
      {/* Mock Scanner View Finder */}
      <View style={styles.viewFinderContainer}>
        <View style={styles.viewFinder}>
          {/* Corner Markers */}
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
          
          <Ionicons name="scan-outline" size={80} color="rgba(255, 255, 255, 0.3)" />
          
          {/* Animated Scanning Red Line */}
          <View style={styles.scannerLaser} />
        </View>
      </View>

      <TouchableOpacity 
        style={styles.simulateScanBtn}
        onPress={() => Alert.alert('Scan Simulation', 'In the final app, this opens the camera to scan a merchant payment QR code.')}
      >
        <Ionicons name="camera" size={20} color="#FFFFFF" />
        <Text style={styles.simulateScanBtnText}>Simulate Camera Scan</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  scannerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: 110,
  },
  tabHeaderTitleCentered: {
    fontSize: 24,
    fontWeight: '800',
    color: '#001E42',
    marginBottom: 10,
    textAlign: 'center',
  },
  scannerSubtitle: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 30,
    paddingHorizontal: 20,
  },
  viewFinderContainer: {
    width: 250,
    height: 250,
    backgroundColor: '#000000',
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
    borderWidth: 2,
    borderColor: '#374151',
  },
  viewFinder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#3B82F6',
  },
  topLeft: {
    top: 20,
    left: 20,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: 20,
    right: 20,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: 20,
    left: 20,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: 20,
    right: 20,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  scannerLaser: {
    position: 'absolute',
    left: 20,
    right: 20,
    height: 2,
    backgroundColor: '#3B82F6',
    top: '50%',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  simulateScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#001E42',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  simulateScanBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
