import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors, shadows } from '../../constants/theme';
import { typography } from '../../constants/typography';

type WalletModeCardProps = {
  title: string;
  description: string;
  selected?: boolean;
  tone?: 'light' | 'dark';
  icon?: 'wallet' | 'merchant';
  onPress?: () => void;
};

export function WalletModeCard({
  title,
  description,
  selected,
  tone = 'light',
  icon = 'wallet',
  onPress,
}: WalletModeCardProps) {
  const dark = tone === 'dark';

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        dark ? styles.cardDark : styles.cardLight,
        selected && (dark ? styles.selectedDark : styles.selectedLight),
      ]}
    >
      <View style={styles.topRow}>
        <ModeIcon type={icon} dark={dark} />
        {selected ? (
          <Ionicons
            name="checkmark-circle"
            size={24}
            color={dark ? colors.surface : colors.ink}
          />
        ) : (
          <View style={[styles.unselectedIndicator, dark && styles.unselectedIndicatorDark]} />
        )}
      </View>
      <Text style={[styles.title, dark && styles.titleDark]}>{title}</Text>
      <Text style={[styles.description, dark && styles.descriptionDark]}>{description}</Text>
    </Pressable>
  );
}

function ModeIcon({ type, dark }: { type: 'wallet' | 'merchant'; dark: boolean }) {
  const color = dark ? colors.surface : colors.ink;
  const iconName = type === 'merchant' ? 'storefront-outline' : 'wallet-outline';

  return (
    <View style={[styles.iconWrapper, dark ? styles.iconWrapperDark : styles.iconWrapperLight]}>
      <Ionicons name={iconName} size={22} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 150,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    justifyContent: 'flex-end',
    ...shadows.soft,
  },
  cardLight: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  cardDark: {
    backgroundColor: '#1E1F24',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  selectedLight: {
    borderColor: colors.ink,
    borderWidth: 2,
    ...shadows.card,
  },
  selectedDark: {
    borderColor: colors.surface,
    borderWidth: 2,
    ...shadows.card,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 'auto',
    paddingBottom: spacing.md,
  },
  unselectedIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(8, 9, 10, 0.15)',
  },
  unselectedIndicatorDark: {
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  iconWrapper: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapperLight: {
    backgroundColor: 'rgba(8, 9, 10, 0.04)',
  },
  iconWrapperDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  title: {
    ...typography.title,
    fontSize: 18,
    fontWeight: '900',
    color: colors.ink,
  },
  titleDark: {
    color: colors.surface,
  },
  description: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  descriptionDark: {
    color: 'rgba(255, 255, 255, 0.6)',
    maxWidth: 230,
  },
});
