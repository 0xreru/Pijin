import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors, shadows } from '../../constants/theme';

type AppCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  bordered?: boolean;
  shadow?: boolean;
};

export function AppCard({ children, style, bordered = false, shadow = false }: AppCardProps) {
  return <View style={[styles.card, bordered && styles.bordered, shadow && shadows.soft, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  bordered: {
    borderWidth: 1,
    borderColor: colors.border,
  },
});
