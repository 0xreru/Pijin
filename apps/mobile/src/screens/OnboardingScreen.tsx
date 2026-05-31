import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, useRef } from 'react';
import { Animated, Dimensions, Image, FlatList, Pressable, StyleSheet, Text, View, ImageSourcePropType } from 'react-native';
import { ScreenContainer } from '../components/ui/ScreenContainer';
import { AppButton } from '../components/ui/AppButton';
import { radius } from '../constants/radius';
import { spacing } from '../constants/spacing';
import { colors, shadows } from '../constants/theme';
import { typography } from '../constants/typography';

const { width } = Dimensions.get('window');

type OnboardingSlide = {
  id: string;
  title: string;
  description: string;
  image: ImageSourcePropType;
  accent: string;
};

const SLIDES: OnboardingSlide[] = [
  {
    id: '1',
    title: 'Secure Stellar Escrow',
    description: 'Lock your funds safely inside decentralized Soroban smart contract escrows with hardware-grade cryptographic proof.',
    image: require('../../assets/onboard-1.png'),
    accent: '#4CD964', // Emerald glow
  },
  {
    id: '2',
    title: 'True Offline Payments',
    description: 'Transact entirely offline. Pay and receive digital cash securely via simple SMS messages with absolutely zero internet required.',
    image: require('../../assets/onboard-2.png'),
    accent: '#F2C94C', // Gold hardware glow
  },
  {
    id: '3',
    title: 'Next-Gen Personal Vault',
    description: 'Monitor your local hardware balances and track pending transactions instantly inside a clean, modern Slate interface.',
    image: require('../../assets/onboard-3.png'),
    accent: '#5AC8FA', // Sky glow
  },
];

type OnboardingScreenProps = {
  onFinish: () => void;
};

export function OnboardingScreen({ onFinish }: OnboardingScreenProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const viewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index || 0);
    }
  }).current;

  const viewConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  function handleNext() {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      onFinish();
    }
  }

  function handleSkip() {
    onFinish();
  }

  return (
    <ScreenContainer scroll={false} bottomInset={false} contentStyle={styles.container}>
      {/* Header Skip */}
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.logoText}>AbotPera</Text>
        </View>
        {currentIndex < SLIDES.length - 1 && (
          <Pressable style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]} onPress={handleSkip}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        )}
      </View>

      {/* Slider list */}
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <View style={[styles.imageCard, { shadowColor: item.accent }]}>
              <Image source={item.image} style={styles.slideImage} resizeMode="contain" />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.description}>{item.description}</Text>
            </View>
          </View>
        )}
        horizontal
        showsHorizontalScrollIndicator={false}
        pagingEnabled
        bounces={false}
        keyExtractor={(item) => item.id}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: false,
        })}
        onViewableItemsChanged={viewableItemsChanged}
        viewabilityConfig={viewConfig}
        scrollEventThrottle={32}
        style={styles.list}
      />

      {/* Footer controls */}
      <View style={styles.footer}>
        {/* Indicators */}
        <View style={styles.indicatorContainer}>
          {SLIDES.map((_, i) => {
            const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
            const dotWidth = scrollX.interpolate({
              inputRange,
              outputRange: [8, 22, 8],
              extrapolate: 'clamp',
            });
            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.35, 1, 0.35],
              extrapolate: 'clamp',
            });

            return (
              <Animated.View
                key={i.toString()}
                style={[styles.dot, { width: dotWidth, opacity }]}
              />
            );
          })}
        </View>

        {/* Action Button */}
        <AppButton
          title={currentIndex === SLIDES.length - 1 ? 'GET STARTED' : 'CONTINUE'}
          onPress={handleNext}
          style={styles.actionBtn}
          icon={currentIndex === SLIDES.length - 1 ? (
            <Ionicons name="arrow-forward-outline" size={17} color={colors.surface} />
          ) : undefined}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  header: {
    height: 70,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xl,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
  },
  logoText: {
    ...typography.title,
    fontSize: 18,
    fontWeight: '900',
    color: colors.ink,
    letterSpacing: -0.2,
  },
  skipButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  skipText: {
    ...typography.caption,
    color: colors.mutedDark,
    fontSize: 13,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  slide: {
    width,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  imageCard: {
    width: 240,
    height: 240,
    borderRadius: radius.xl,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
    marginBottom: spacing.xxl,
    overflow: 'hidden',
  },
  slideImage: {
    width: '100%',
    height: '100%',
  },
  textContainer: {
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    fontSize: 26,
    color: colors.ink,
    fontWeight: '900',
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    paddingHorizontal: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl + 10,
    alignItems: 'center',
    gap: spacing.xl,
  },
  indicatorContainer: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    alignItems: 'center',
    height: 12,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.ink,
  },
  actionBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    alignSelf: 'stretch',
    ...shadows.card,
  },
  pressed: {
    opacity: 0.82,
  },
});
