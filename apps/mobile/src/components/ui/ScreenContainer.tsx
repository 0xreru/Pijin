import { ReactNode } from 'react';
import { SafeAreaView, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { spacing } from '../../constants/spacing';
import { colors } from '../../constants/theme';

type ScreenContainerProps = {
  children: ReactNode;
  scroll?: boolean;
  bottomInset?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  backgroundColor?: string;
};

export function ScreenContainer({
  children,
  scroll = true,
  bottomInset = true,
  contentStyle,
  backgroundColor = colors.background,
}: ScreenContainerProps) {
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, bottomInset && styles.bottomInset, contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill, bottomInset && styles.bottomInset, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
  },
  bottomInset: {
    paddingBottom: spacing.xxl,
  },
});
