import Ionicons from '@expo/vector-icons/Ionicons';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors } from '../../constants/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type BottomTab = 'Home' | 'Pay' | 'Wallet';

type NavItem = {
  label: BottomTab;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
};

const items: NavItem[] = [
  {
    label: 'Home',
    icon: 'home-outline',
    activeIcon: 'home',
  },
  {
    label: 'Pay',
    icon: 'qr-code-outline',
    activeIcon: 'qr-code',
  },
  {
    label: 'Wallet',
    icon: 'wallet-outline',
    activeIcon: 'wallet',
  },
];

type BottomNavBarProps = {
  active: BottomTab;
  onTabPress?: (tab: BottomTab) => void;
};

export function BottomNavBar({ active, onTabPress }: BottomNavBarProps) {
  const handleTabPress = (tab: BottomTab) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onTabPress?.(tab);
  };

  return (
    <View style={styles.wrap}>
      {items.map((item) => {
        const isActive = item.label === active;

        return (
          <Pressable
            key={item.label}
            style={({ pressed }) => [styles.item, isActive && styles.activeItem, pressed && styles.pressed]}
            onPress={() => handleTabPress(item.label)}
          >
            <Ionicons
              name={isActive ? item.activeIcon : item.icon}
              size={22}
              color={colors.surface}
            />

            {isActive ? <Text style={styles.activeLabel}>{item.label}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
    minHeight: 64,
    minWidth: 220,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  item: {
    height: 42,
    minWidth: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  activeItem: {
    minWidth: 108,
    backgroundColor: '#656565',
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.78,
  },
  activeLabel: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
});
