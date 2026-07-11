import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { typography } from '../../constants/typography';

export interface TransactionItemProps {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  type: 'incoming' | 'outgoing' | 'transfer' | 'settlement';
  timestamp?: string;
}

export function TransactionItem({
  title,
  subtitle,
  amount,
  type,
  timestamp,
}: TransactionItemProps) {
  const isIncoming = type === 'incoming' || type === 'settlement' || (type === 'transfer' && amount > 0);

  // Format currency
  const formatAmount = (val: number) => {
    const formatted = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(Math.abs(val));
    return isIncoming ? `+ ${formatted}` : `- ${formatted}`;
  };

  const getIconName = () => {
    return isIncoming ? 'arrow-down' : 'arrow-up';
  };

  return (
    <View style={styles.container}>
      <View style={styles.leftSection}>
        <View style={styles.iconWrapper}>
          <Ionicons
            name={getIconName()}
            size={18}
            color="#FFFFFF"
            style={styles.rotatedIcon}
          />
        </View>
        <View style={styles.textWrapper}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>
      <View style={styles.rightSection}>
        <Text style={[styles.amountText, { color: isIncoming ? '#10B981' : '#001E42' }]}>
          {formatAmount(amount)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#E6E9EE',
    justifyContent: 'space-between',
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#001E42',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rotatedIcon: {
    transform: [{ rotate: '45deg' }],
  },
  textWrapper: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#001E42',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    color: '#707984',
  },
  rightSection: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 10,
  },
  amountText: {
    fontSize: 15,
    fontWeight: '700',
  },
});

