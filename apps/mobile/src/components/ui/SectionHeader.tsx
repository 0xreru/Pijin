import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
}

export function SectionHeader({ title, actionLabel, onActionPress }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.titleText}>{title}</Text>
      {actionLabel && onActionPress && (
        <TouchableOpacity onPress={onActionPress} activeOpacity={0.7}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 10,
  },
  titleText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#031634',
    letterSpacing: -0.2,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#04295A',
  },
});

