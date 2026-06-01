import { useEffect, useRef, useState } from 'react';
import { useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { MerchantTab } from '../../components/ui/MerchantBottomNavBar';
import { spacing } from '../../constants/spacing';
import { colors } from '../../constants/theme';
import { typography } from '../../constants/typography';
import { OfflinePaymentPayload } from '../../types/payment';
import { buildOfflineSmsVoucher } from '../../services/offline/buildSmsPayload';
import { loadStoredAccount } from '../../services/storage/accountStorage';
import {
  loadOfflinePaymentsQueue,
  appendToOfflinePaymentsQueue,
} from '../../services/storage/paymentQueueStorage';
import { buildQrJsonFromVoucher, parseOfflinePaymentPayload } from '../../utils/offlinePaymentPayload';

// Import split panel components
import {
  IdlePanel,
  PermissionPanel,
  ScannerPanel,
  ScannedPanel,
  SmsPreparedPanel,
  QueuedPanel,
  InvalidPanel,
  StatusPanel,
  ActionStack,
} from '../../components/merchant';

type ScannerState =
  | 'idle'
  | 'scanner'
  | 'scanned'
  | 'sms-prepared'
  | 'queued'
  | 'settled'
  | 'invalid';

type MerchantScannerScreenProps = {
  connectedPublicKey?: string;
  merchantShortId?: string;
  onMerchantTabPress?: (tab: MerchantTab) => void;
  onBackToDashboard?: () => void;
  onViewHistory?: () => void;
  initialState?: 'idle' | 'scanner';
  onStateChange?: (state: 'idle' | 'scanner') => void;
  onLogout?: () => void;
};

export function MerchantScannerScreen({
  connectedPublicKey,
  merchantShortId,
  onMerchantTabPress,
  onBackToDashboard,
  onViewHistory,
  initialState,
  onStateChange,
  onLogout,
}: MerchantScannerScreenProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannerState, setScannerState] = useState<ScannerState>(initialState || 'scanner');
  const [paymentPayload, setPaymentPayload] = useState<OfflinePaymentPayload | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDemoPayload, setIsDemoPayload] = useState(false);
  const [isScannerLocked, setIsScannerLocked] = useState(false);
  const scannerLockRef = useRef(false);
  const [pendingQueue, setPendingQueue] = useState<OfflinePaymentPayload[]>([]);
  const [storedMerchantShortId, setStoredMerchantShortId] = useState<string | null>(null);
  const resolvedMerchantShortId = merchantShortId ?? storedMerchantShortId ?? undefined;

  useEffect(() => {
    if (onStateChange && (scannerState === 'idle' || scannerState === 'scanner')) {
      onStateChange(scannerState);
    }
  }, [scannerState, onStateChange]);

  // Load account role info
  useEffect(() => {
    let mounted = true;
    loadStoredAccount()
      .then((account) => {
        if (!mounted) return;
        if (account?.role === 'MERCHANT' && account.shortId) {
          setStoredMerchantShortId(account.shortId);
        }
      })
      .catch(() => {
        if (mounted) {
          setStoredMerchantShortId(null);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Load the persisted offline payments queue from local storage
  useEffect(() => {
    let mounted = true;
    loadOfflinePaymentsQueue()
      .then((queue) => {
        if (mounted) {
          setPendingQueue(queue);
        }
      })
      .catch((error) => {
        console.error('[MerchantScannerScreen] failed to load persistent queue:', error);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const isScannerActive = scannerState === 'scanner';
  const hasCameraPermission = permission?.granted === true;

  function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (scannerLockRef.current || !isScannerActive) {
      return;
    }

    if (result.type !== 'qr') {
      return;
    }

    scannerLockRef.current = true;
    setIsScannerLocked(true);
    handleParsedPayload(result.data, false);
  }

  async function handleUseDemoPayload() {
    if (!resolvedMerchantShortId) {
      setParseError('Register merchant account first (M-xxxx).');
      setScannerState('invalid');
      return;
    }

    try {
      const built = await buildOfflineSmsVoucher({
        customerShortId: 'C-SAMPLE',
        merchantShortId: resolvedMerchantShortId,
        amountPhp: 252,
      });
      const payload = {
        type: 'ABOTPERA_OFFLINE_PAYMENT' as const,
        version: 2 as const,
        amount: 252,
        currency: 'PHP' as const,
        customerShortId: 'C-SAMPLE',
        merchantShortId: resolvedMerchantShortId,
        smsBody: built.smsBody,
        createdAt: new Date().toISOString(),
        expiresInMinutes: 10,
      };
      scannerLockRef.current = true;
      setIsScannerLocked(true);
      handleParsedPayload(buildQrJsonFromVoucher(payload), true);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Demo payload failed.');
      setScannerState('invalid');
    }
  }

  function handleParsedPayload(raw: string, demo: boolean) {
    try {
      const parsed = parseOfflinePaymentPayload(raw);
      setPaymentPayload(parsed);
      setParseError(null);
      setIsDemoPayload(demo);
      setScannerState('scanned');
    } catch (error) {
      setPaymentPayload(null);
      setParseError(error instanceof Error ? error.message : 'Unable to parse payment QR.');
      setIsDemoPayload(demo);
      setScannerState('invalid');
    }
  }

  function handlePrepareSms() {
    setScannerState('sms-prepared');
  }

  async function handleAcceptOffline() {
    if (paymentPayload) {
      try {
        const updated = await appendToOfflinePaymentsQueue(paymentPayload);
        setPendingQueue(updated);
      } catch (error) {
        console.error('[MerchantScannerScreen] failed to append to persistent queue:', error);
        // Fallback to local state if storage fails
        setPendingQueue((current) => [paymentPayload, ...current]);
      }
    }

    setScannerState('queued');
  }

  function handleScanAnother() {
    setScannerState('scanner');
    setPaymentPayload(null);
    setParseError(null);
    setIsDemoPayload(false);
    scannerLockRef.current = false;
    setIsScannerLocked(false);
  }

  function renderContent() {
    if (scannerState === 'idle') {
      return (
        <IdlePanel
          connectedPublicKey={connectedPublicKey}
          onStartScanner={() => setScannerState('scanner')}
          onUseDemoPayload={handleUseDemoPayload}
          onLogout={onLogout}
        />
      );
    }

    if (isScannerActive && !hasCameraPermission) {
      return (
        <PermissionPanel
          onRequestPermission={requestPermission}
          connectedPublicKey={connectedPublicKey}
          onUseDemoPayload={handleUseDemoPayload}
          onClose={() => setScannerState('idle')}
          onLogout={onLogout}
        />
      );
    }

    if (isScannerActive) {
      return (
        <ScannerPanel
          connectedPublicKey={connectedPublicKey}
          isLocked={isScannerLocked}
          onBarcodeScanned={handleBarcodeScanned}
          onScanAgain={handleScanAnother}
          onUseDemoPayload={handleUseDemoPayload}
          onClose={() => setScannerState('idle')}
          onLogout={onLogout}
        />
      );
    }

    if (scannerState === 'scanned' && paymentPayload) {
      return (
        <ScannedPanel
          payload={paymentPayload}
          isDemoPayload={isDemoPayload}
          merchantShortId={resolvedMerchantShortId}
          onPrepareSms={handlePrepareSms}
          onAcceptOffline={handleAcceptOffline}
          onScanAnother={handleScanAnother}
        />
      );
    }

    if (scannerState === 'sms-prepared' && paymentPayload) {
      return (
        <SmsPreparedPanel
          payload={paymentPayload}
          onScanAnother={handleScanAnother}
          onBackToDashboard={onBackToDashboard}
          onViewHistory={onViewHistory}
        />
      );
    }

    if (scannerState === 'settled' && paymentPayload) {
      return (
        <StatusPanel icon="checkmark-circle" title="Settlement Submitted">
          <Text style={styles.panelText}>
            Payment has been sent to the backend for on-chain settlement.
          </Text>
          <ActionStack
            onScanAnother={handleScanAnother}
            onBackToDashboard={onBackToDashboard}
            onViewHistory={onViewHistory}
          />
        </StatusPanel>
      );
    }

    if (scannerState === 'queued' && paymentPayload) {
      return (
        <QueuedPanel
          pendingCount={pendingQueue.length}
          onScanAnother={handleScanAnother}
          onBackToDashboard={onBackToDashboard}
          onViewHistory={onViewHistory}
        />
      );
    }

    return <InvalidPanel error={parseError} onRetry={handleScanAnother} />;
  }

  return (
    <ScreenContainer
      scroll={false}
      contentStyle={[styles.screen, { paddingTop: insets.top || spacing.md }]}
      backgroundColor={colors.backgroundSoft}
    >
      <View style={styles.root}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {renderContent()}
        </ScrollView>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 0,
  },
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: 140,
    flexGrow: 1,
  },
  panelText: {
    ...typography.body,
    fontSize: 14,
    color: colors.mutedDark,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
});
