import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/theme';
import { typography } from '../../constants/typography';

type SectionHeaderProps = {
  title: string;
  action?: string;
};

export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {action ? <Text style={styles.action}>{action}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...typography.sectionTitle,
    color: colors.mutedDark,
  },
  action: {
    ...typography.caption,
    color: colors.ink,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
});
