import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { connectionService } from '../../services/connectionService';

interface ConnectionWatcherProps {
  navigation?: any;
  currentMode: 'online' | 'offline';
  onOfflineRedirect?: () => void;
}

export function ConnectionWatcher({ navigation, currentMode, onOfflineRedirect }: ConnectionWatcherProps) {
  const [showBanner, setShowBanner] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const bannerAnim = useRef(new Animated.Value(-120)).current;
  
  const timerRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    const subscription = connectionService.state$.subscribe((state) => {
      // If physically disconnected and currently on an Online page/flow
      if (!state.isConnected && currentMode === 'online') {
        if (!showBanner) {
          setShowBanner(true);
          setCountdown(3);

          // Animate banner sliding in from top
          Animated.spring(bannerAnim, {
            toValue: 10,
            useNativeDriver: true,
            tension: 40,
            friction: 8,
          }).start();

          // 3-second redirect timer
          timerRef.current = setTimeout(() => {
            Animated.timing(bannerAnim, {
              toValue: -120,
              duration: 250,
              useNativeDriver: true,
            }).start(() => {
              setShowBanner(false);
              if (onOfflineRedirect) {
                onOfflineRedirect();
              } else if (navigation) {
                navigation.navigate('Dashboard');
              }
            });
          }, 3000);

          // Countdown tick
          let currentCount = 3;
          intervalRef.current = setInterval(() => {
            currentCount -= 1;
            if (currentCount >= 0) {
              setCountdown(currentCount);
            }
          }, 1000);
        }
      } else {
        // If we regained connection or if we are in Offline mode, hide the banner
        if (showBanner) {
          if (timerRef.current) clearTimeout(timerRef.current);
          if (intervalRef.current) clearInterval(intervalRef.current);

          Animated.timing(bannerAnim, {
            toValue: -120,
            duration: 250,
            useNativeDriver: true,
          }).start(() => {
            setShowBanner(false);
          });
        }
      }
    });

    return () => {
      subscription.unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [currentMode, showBanner]);

  if (!showBanner) return null;

  return (
    <Animated.View style={[styles.bannerContainer, { transform: [{ translateY: bannerAnim }] }]}>
      <View style={styles.bannerContent}>
        <View style={styles.iconCircle}>
          <Ionicons name="cloud-offline-outline" size={20} color="#EF4444" />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title}>Internet Connection Lost</Text>
          <Text style={styles.subtitle}>
            Switching to Offline mode in {countdown}s...
          </Text>
        </View>
        <ActivityIndicator size="small" color="#FFFFFF" style={styles.spinner} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bannerContainer: {
    position: 'absolute',
    top: 40,
    left: 16,
    right: 16,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    padding: 16,
    zIndex: 99999,
    borderWidth: 1.5,
    borderColor: '#EF4444',
    shadowColor: '#04295A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 8,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  spinner: {
    marginLeft: 12,
  },
});
