import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  Share,
  ScrollView,
  Dimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function TransactionReceiptScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  
  // Destructure route params (or fallback to mock reference values if params are empty)
  const { transaction } = route.params || {};
  
  const isRealTx = !!transaction;
  const amount = transaction?.amount 
    ? `₱${Math.abs(transaction.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
    : '₱25,000.00';
  const title = transaction?.title || 'Deposited from G-Xchange Inc. / Gcash';
  const description = transaction?.description || 'You deposited ₱25,000.00 using G-Xchange Inc. / GCash account ending in 8245 via Pijin.';
  
  // Extract variables depending on transaction type
  const isIncoming = transaction 
    ? (transaction.type === 'incoming' || transaction.type === 'settlement' || (transaction.type === 'transfer' && transaction.amount > 0)) 
    : true;

  // Header Title
  const headerTitle = isRealTx 
    ? (transaction.type === 'transfer' ? 'Funds Transferred' : (isIncoming ? 'Money Received' : 'Money Sent'))
    : 'Deposited money from';

  // Subtitle/Date
  const dateStr = transaction?.subtitle || 'June 03, 2026, 06:13 PM';

  // Let's determine counterparty info
  let accountName = 'PEARSON SPECTER LITT';
  let accountType = 'G-Xchange Inc. / Gcash';
  let accountNumber = '1000988884782910993';

  if (isRealTx) {
    accountName = transaction.title;
    accountType = transaction.tag === 'OFFLINE' ? 'Offline Vault' : 'Online Wallet';
    accountNumber = transaction.id;
  }

  // Reference IDs
  let referenceId = '134F 5748 DU30';
  let traceNo = '9837211';
  let gcashRefNo = '9837211';
  const hasGcashDetails = !isRealTx;

  if (isRealTx) {
    referenceId = transaction.id;
    // Extract transaction hash if present in description
    if (transaction.description && transaction.description.startsWith('Stellar Tx Hash: ')) {
      const hash = transaction.description.replace('Stellar Tx Hash: ', '');
      traceNo = hash.substring(0, 12) + '...';
      gcashRefNo = hash;
    } else {
      traceNo = 'N/A';
      gcashRefNo = 'N/A';
    }
  }

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Pijin Transaction Receipt\nAmount: ${amount}\nFrom: ${accountName}\nDate: ${dateStr}\nReference ID: ${referenceId}`,
      });
    } catch (error) {
      console.error('Sharing failed:', error);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
          <Ionicons name="arrow-undo-outline" size={28} color="#000000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Main Card */}
        <View style={styles.receiptCard}>
          <View style={styles.cardInfoContainer}>
            <View style={styles.amountNameCol}>
              <Text style={styles.amountText}>{amount}</Text>
              <Text style={styles.nameText}>{accountName}</Text>
            </View>
            
            {/* Logo/Icon Wrapper */}
            <View style={styles.logoWrapper}>
              <View style={styles.logoCircleShadow}>
                {hasGcashDetails ? (
                  <Image
                    source={require('../../assets/logos/gcash-logo.png')}
                    style={styles.gcashLogo}
                    resizeMode="contain"
                  />
                ) : (
                  <Ionicons 
                    name={isIncoming ? "arrow-down" : "arrow-up"} 
                    size={24} 
                    color="#04295A" 
                  />
                )}
              </View>
              {/* Overlay Down Arrow Badge */}
              {hasGcashDetails && (
                <View style={styles.badgeOverlay}>
                  <Ionicons name="arrow-down" size={10} color="#FFFFFF" />
                </View>
              )}
            </View>
          </View>

          {/* Status Row */}
          <View style={styles.statusRow}>
            <View style={styles.statusBadge}>
              <Ionicons name="checkmark" size={16} color="#04295A" style={styles.checkIcon} />
              <Text style={styles.statusText}>Completed</Text>
            </View>
            <Text style={styles.dateText}>{dateStr}</Text>
          </View>
        </View>

        {/* Share Button */}
        <TouchableOpacity style={styles.shareButton} onPress={handleShare} activeOpacity={0.9}>
          <Ionicons name="share-social-outline" size={18} color="#FFFFFF" style={styles.shareIcon} />
          <Text style={styles.shareButtonText}>Share</Text>
        </TouchableOpacity>

        {/* Fields Table */}
        <View style={styles.tableContainer}>
          {/* Section 1 */}
          <View style={styles.tableRow}>
            <Text style={styles.tableLabel}>{isRealTx ? 'Transaction source' : 'Account type'}</Text>
            <Text style={styles.tableValue}>{accountType}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableLabel}>{isRealTx ? 'Transaction ID' : 'Account Number'}</Text>
            <Text style={[styles.tableValue, { maxWidth: '60%' }]} numberOfLines={1}>{accountNumber}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableLabel}>{isRealTx ? 'Transaction details' : 'Account Name'}</Text>
            <Text style={styles.tableValue}>{accountName}</Text>
          </View>

          <View style={styles.divider} />

          {/* Section 2 */}
          {hasGcashDetails ? (
            <>
              <View style={styles.tableRow}>
                <Text style={styles.tableLabel}>Reference ID</Text>
                <Text style={styles.tableValue}>{referenceId}</Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={styles.tableLabel}>Trace No</Text>
                <Text style={styles.tableValue}>{traceNo}</Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={styles.tableLabel}>Gcash Ref. No</Text>
                <Text style={styles.tableValue}>{gcashRefNo}</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.tableRow}>
                <Text style={styles.tableLabel}>Transaction status</Text>
                <Text style={[styles.tableValue, { color: '#10B981', fontWeight: '800' }]}>
                  {transaction.description && transaction.description.startsWith('Status: ') 
                    ? transaction.description.replace('Status: ', '') 
                    : 'Completed'}
                </Text>
              </View>
              {transaction.description && transaction.description.startsWith('Stellar Tx Hash: ') && (
                <View style={styles.tableRow}>
                  <Text style={styles.tableLabel}>Stellar Hash</Text>
                  <Text style={[styles.tableValue, { maxWidth: '60%' }]} numberOfLines={1}>
                    {transaction.description.replace('Stellar Tx Hash: ', '')}
                  </Text>
                </View>
              )}
            </>
          )}

          <View style={styles.divider} />
        </View>

        {/* Footer */}
        <View style={styles.footerContainer}>
          <Text style={styles.pijinLogo}>p i j i n</Text>
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.getHelpLink}>Get help</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EFF1F5',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#000000',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  receiptCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    marginTop: 10,
    marginBottom: 20,
  },
  cardInfoContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  amountNameCol: {
    flex: 1,
    paddingRight: 10,
  },
  amountText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#04295A',
    marginBottom: 4,
  },
  nameText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4B5563',
    letterSpacing: 0.5,
  },
  logoWrapper: {
    position: 'relative',
    width: 50,
    height: 50,
  },
  logoCircleShadow: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  gcashLogo: {
    width: 32,
    height: 32,
  },
  badgeOverlay: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#04295A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EFF1F5',
    paddingTop: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkIcon: {
    marginRight: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#04295A',
  },
  dateText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  shareButton: {
    backgroundColor: '#04295A',
    borderRadius: 30,
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  shareIcon: {
    marginRight: 8,
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  tableContainer: {
    marginBottom: 20,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  tableLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#707984',
  },
  tableValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  divider: {
    height: 1,
    backgroundColor: '#D1D5DB',
    marginVertical: 12,
  },
  footerContainer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  pijinLogo: {
    fontSize: 24,
    fontWeight: '800',
    color: '#04295A',
    letterSpacing: 8,
    marginBottom: 8,
  },
  getHelpLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#04295A',
    textDecorationLine: 'underline',
  },
});
