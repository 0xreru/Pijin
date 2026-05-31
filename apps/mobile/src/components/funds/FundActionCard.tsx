import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors } from '../../constants/theme';
import { typography } from '../../constants/typography';

type FundActionCardProps = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

export function FundActionCard({ title, description, icon }: FundActionCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.icon}>
        <Ionicons name={icon} size={22} color={colors.ink} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
  },
  title: {
    ...typography.body,
    fontWeight: '800',
    color: colors.ink,
  },
  description: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
  },
});
