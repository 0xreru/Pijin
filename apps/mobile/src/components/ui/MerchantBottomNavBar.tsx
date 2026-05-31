import Ionicons from '@expo/vector-icons/Ionicons';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors } from '../../constants/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type MerchantTab = 'Dashboard' | 'Scan' | 'Wallet';

type MerchantNavItem = {
  label: MerchantTab;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
};

const items: MerchantNavItem[] = [
  {
    label: 'Dashboard',
    icon: 'grid-outline',
    activeIcon: 'grid',
  },
  {
    label: 'Scan',
    icon: 'scan-outline',
    activeIcon: 'scan',
  },
  {
    label: 'Wallet',
    icon: 'wallet-outline',
    activeIcon: 'wallet',
  },
];

type MerchantBottomNavBarProps = {
  active: MerchantTab;
  onTabPress?: (tab: MerchantTab) => void;
};

export function MerchantBottomNavBar({ active, onTabPress }: MerchantBottomNavBarProps) {
  const handleTabPress = (tab: MerchantTab) => {
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
            style={({ pressed }) => [
              styles.item,
              isActive && styles.activeItem,
              pressed && styles.pressed,
            ]}
            onPress={() => handleTabPress(item.label)}
          >
            <Ionicons
              name={isActive ? item.activeIcon : item.icon}
              size={22}
              color={colors.surface}
              style={!isActive && styles.inactiveIcon}
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
    minWidth: 252,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  item: {
    height: 48,
    minWidth: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  activeItem: {
    minWidth: 124,
    backgroundColor: '#2E2E2E',
    paddingHorizontal: spacing.md,
  },
  inactiveIcon: {
    opacity: 0.42,
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
