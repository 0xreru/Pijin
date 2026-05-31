import { type ReactNode, useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import { Linking, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { MerchantBottomNavBar, MerchantTab } from '../../components/ui/MerchantBottomNavBar';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors, shadows } from '../../constants/theme';
import { typography } from '../../constants/typography';
import { OfflinePaymentPayload } from '../../types/payment';
import { formatCurrency } from '../../utils/formatCurrency';
import { SMS_GATEWAY_NUMBER } from '../../constants/api';
import { simulateSmsSettlement } from '../../services/api/settlement';
import { buildOfflineSmsVoucher } from '../../services/offline/buildSmsPayload';
import { loadStoredAccount } from '../../services/storage/accountStorage';
import { buildQrJsonFromVoucher, parseOfflinePaymentPayload } from '../../utils/offlinePaymentPayload';

type ScannerState = 'idle' | 'scanner' | 'scanned' | 'sms-prepared' | 'queued' | 'settled' | 'invalid';

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

  function handleAcceptOffline() {
    if (paymentPayload) {
      setPendingQueue((current) => [paymentPayload, ...current]);
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
          <Text style={styles.panelText}>Payment has been sent to the backend for on-chain settlement.</Text>
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
    <ScreenContainer scroll={false} contentStyle={styles.screen} backgroundColor={colors.backgroundSoft}>
      <View style={styles.root}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {renderContent()}
        </ScrollView>
      </View>
    </ScreenContainer>
  );
}

function ScannerHeader({
  connectedPublicKey,
  onLogout,
}: {
  connectedPublicKey?: string;
  onLogout?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View style={styles.headerAvatarContainer}>
          <Ionicons name="qr-code" size={24} color={colors.ink} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Scan Payment QR</Text>
          {connectedPublicKey ? (
            <View style={styles.keyPill}>
              <Ionicons name="wallet-outline" size={10} color={colors.muted} />
              <Text style={styles.keyPillText}>{shortenPublicKey(connectedPublicKey)}</Text>
            </View>
          ) : (
            <View style={[styles.keyPill, styles.keyPillDisconnected]}>
              <Ionicons name="warning-outline" size={10} color={colors.danger} />
              <Text style={[styles.keyPillText, { color: colors.danger }]}>No merchant wallet</Text>
            </View>
          )}
        </View>
      </View>
      {onLogout && (
        <Pressable
          style={({ pressed }) => [styles.headerLogoutButton, pressed && styles.pressed]}
          onPress={onLogout}
        >
          <Ionicons name="log-out-outline" size={20} color={colors.surface} />
        </Pressable>
      )}
    </View>
  );
}

function IdlePanel({
  connectedPublicKey,
  onStartScanner,
  onUseDemoPayload,
  onLogout,
}: {
  connectedPublicKey?: string;
  onStartScanner: () => void;
  onUseDemoPayload: () => void;
  onLogout?: () => void;
}) {
  return (
    <View style={styles.scannerContent}>
      <ScannerHeader connectedPublicKey={connectedPublicKey} onLogout={onLogout} />

      <AppCard bordered style={styles.permissionCard}>
        <View style={styles.statusIconContainer}>
          <Ionicons name="camera-reverse-outline" size={28} color={colors.ink} />
        </View>
        <Text style={styles.statusPanelTitle}>Scanner Inactive</Text>
        <Text style={styles.panelText}>Tap the button below to activate the camera viewfinder and scan customer payment QR codes.</Text>
        
        <AppButton
          title="Open Camera"
          onPress={onStartScanner}
          variant="primary"
          icon={<Ionicons name="scan-outline" size={18} color={colors.surface} />}
          style={styles.panelButton}
        />
      </AppCard>

      <SmallDebugButton onPress={onUseDemoPayload} />
    </View>
  );
}

function PermissionPanel({
  connectedPublicKey,
  onRequestPermission,
  onUseDemoPayload,
  onClose,
  onLogout,
}: {
  connectedPublicKey?: string;
  onRequestPermission: () => void;
  onUseDemoPayload: () => void;
  onClose?: () => void;
  onLogout?: () => void;
}) {
  return (
    <View style={styles.scannerContent}>
      <ScannerHeader connectedPublicKey={connectedPublicKey} onLogout={onLogout} />

      <AppCard bordered style={styles.permissionCard}>
        <View style={styles.statusIconContainer}>
          <Ionicons name="camera-outline" size={28} color={colors.ink} />
        </View>
        <Text style={styles.statusPanelTitle}>Camera access needed</Text>
        <Text style={styles.panelText}>Allow camera access to scan customer payment QR codes.</Text>
        
        <AppButton
          title="Allow Camera"
          onPress={onRequestPermission}
          variant="primary"
          icon={<Ionicons name="camera-outline" size={18} color={colors.surface} />}
          style={styles.panelButton}
        />
        {onClose && (
          <Pressable style={({ pressed }) => [styles.subtleCloseButton, pressed && styles.pressed]} onPress={onClose}>
            <Text style={styles.subtleCloseText}>Cancel</Text>
          </Pressable>
        )}
      </AppCard>

      <SmallDebugButton onPress={onUseDemoPayload} />
    </View>
  );
}

function ScannerPanel({
  connectedPublicKey,
  isLocked,
  onBarcodeScanned,
  onScanAgain,
  onUseDemoPayload,
  onClose,
  onLogout,
}: {
  connectedPublicKey?: string;
  isLocked: boolean;
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
  onScanAgain: () => void;
  onUseDemoPayload: () => void;
  onClose?: () => void;
  onLogout?: () => void;
}) {
  return (
    <View style={styles.scannerContent}>
      <ScannerHeader connectedPublicKey={connectedPublicKey} onLogout={onLogout} />

      <View style={styles.cameraFrame}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          active={!isLocked}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onBarcodeScanned}
        />
        <View pointerEvents="none" style={styles.cameraOverlay}>
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
        </View>
      </View>

      <Text style={styles.scanInstruction}>
        {isLocked ? 'Reading payment voucher...' : 'Align payment QR within frame'}
      </Text>

      <View style={styles.debugActions}>
        <AppButton
          title="Reset Scanner"
          onPress={onScanAgain}
          variant="light"
          icon={<Ionicons name="refresh-outline" size={16} color={colors.ink} />}
          style={styles.scanAgainButton}
        />
        {onClose && (
          <Pressable style={({ pressed }) => [styles.subtleCloseButton, pressed && styles.pressed]} onPress={onClose}>
            <Ionicons name="close" size={14} color={colors.muted} />
            <Text style={styles.subtleCloseText}>Close Camera</Text>
          </Pressable>
        )}
        <SmallDebugButton onPress={onUseDemoPayload} />
      </View>
    </View>
  );
}

function ScannedPanel({
  payload,
  isDemoPayload,
  merchantShortId,
  onPrepareSms,
  onAcceptOffline,
  onScanAnother,
}: {
  payload: OfflinePaymentPayload;
  isDemoPayload: boolean;
  merchantShortId?: string;
  onPrepareSms: () => void;
  onAcceptOffline: () => void;
  onScanAnother: () => void;
}) {
  return (
    <View style={styles.resultContent}>
      <AppCard bordered style={styles.paymentCard}>
        <View style={styles.resultTopRow}>
          <View>
            <Text style={styles.resultEyebrow}>PAYMENT DETECTED</Text>
            <Text style={styles.resultAmount}>{formatCurrency(payload.amount)}</Text>
          </View>
          <View style={styles.readyPill}>
            <View style={styles.readyDot} />
            <Text style={styles.readyText}>READY</Text>
          </View>
        </View>

        {isDemoPayload ? (
          <View style={styles.demoBadgeContainer}>
            <Text style={styles.demoBadge}>Simulation Mode</Text>
          </View>
        ) : null}

        <View style={styles.paymentSummary}>
          <DetailRow label="Customer" value={payload.customerShortId} />
          <DetailRow label="Merchant" value={payload.merchantShortId} />
          {payload.customerPublicKey ? (
            <DetailRow label="Customer Key" value={shortenPublicKey(payload.customerPublicKey)} />
          ) : null}
          <DetailRow label="Created At" value={formatCreatedAt(payload.createdAt)} />
          <DetailRow label="Currency" value={payload.currency} />
        </View>

        {!merchantShortId ? (
          <Text style={styles.mvpNotice}>Register this device as a merchant to settle payments.</Text>
        ) : null}
      </AppCard>

      <View style={styles.optionStack}>
        <OptionButton
          title="Verify via SMS"
          description="Send payload to SMS gateway for on-chain settlement."
          icon="chatbubble-ellipses-outline"
          onPress={onPrepareSms}
        />
        <OptionButton
          title="Accept Offline"
          description="Queue this voucher to settle whenever you are online."
          icon="cloud-offline-outline"
          onPress={onAcceptOffline}
        />
      </View>

      <AppButton
        title="Scan Another"
        onPress={onScanAnother}
        variant="outline"
        icon={<Ionicons name="scan-outline" size={18} color={colors.ink} />}
        style={styles.bottomScanAnother}
      />
    </View>
  );
}

function SmsPreparedPanel({
  payload,
  onScanAnother,
  onBackToDashboard,
  onViewHistory,
}: {
  payload: OfflinePaymentPayload;
  onScanAnother: () => void;
  onBackToDashboard?: () => void;
  onViewHistory?: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function openSmsApp() {
    const body = encodeURIComponent(payload.smsBody);
    const phone = SMS_GATEWAY_NUMBER.trim();
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const candidateUrls = phone
      ? [
          `sms:${phone}${separator}body=${body}`,
          `sms:${phone}?body=${body}`,
          `sms:${phone}&body=${body}`,
          `smsto:${phone}:${payload.smsBody}`,
        ]
      : [`sms:${separator}body=${body}`, `sms:?body=${body}`];

    for (const url of candidateUrls) {
      try {
        const canOpen = await Linking.canOpenURL(url);
        if (!canOpen) {
          continue;
        }
        await Linking.openURL(url);
        setStatus('SMS app opened. Send message to reach gateway.');
        return;
      } catch {
        // Try next URL variant.
      }
    }

    setStatus('Unable to open SMS app. Copy SMS payload below and send manually.');
  }

  async function simulateSettlement() {
    setIsSubmitting(true);
    setStatus(null);
    try {
      const result = await simulateSmsSettlement(payload.smsBody);
      setStatus(result.message + (result.txHash ? ` Tx: ${result.txHash.slice(0, 8)}...` : ''));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Simulation failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <StatusPanel icon="chatbubble-ellipses" title="SMS verification prepared">
      <Text style={styles.panelText}>Send this exact body to the SMS gateway (or simulate via API in dev).</Text>
      
      <View style={styles.smsBodyBox}>
        <Text style={styles.smsBodyLabel}>SMS PAYLOAD</Text>
        <Text style={styles.smsBodyText} selectable>
          {payload.smsBody}
        </Text>
      </View>

      {status ? <Text style={styles.statusMessageText}>{status}</Text> : null}

      <AppButton
        title="Open SMS App"
        onPress={openSmsApp}
        variant="primary"
        icon={<Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.surface} />}
        style={{ marginTop: spacing.xl }}
      />

      <AppButton
        title={isSubmitting ? 'Submitting...' : 'Dev: Simulate settlement API'}
        onPress={simulateSettlement}
        variant="outline"
        disabled={isSubmitting}
        style={{ marginTop: spacing.md }}
      />

      <ActionStack onScanAnother={onScanAnother} onBackToDashboard={onBackToDashboard} onViewHistory={onViewHistory} />
    </StatusPanel>
  );
}

function QueuedPanel({
  pendingCount,
  onScanAnother,
  onBackToDashboard,
  onViewHistory,
}: {
  pendingCount: number;
  onScanAnother: () => void;
  onBackToDashboard?: () => void;
  onViewHistory?: () => void;
}) {
  return (
    <StatusPanel icon="archive" title="Queued Offline">
      <Text style={styles.panelText}>Payment voucher saved to local queue. Will sync automatically when online.</Text>
      <View style={styles.queueCountBadge}>
        <Text style={styles.queueCountText}>
          {pendingCount} payment{pendingCount === 1 ? '' : 's'} queued
        </Text>
      </View>
      <ActionStack onScanAnother={onScanAnother} onBackToDashboard={onBackToDashboard} onViewHistory={onViewHistory} />
    </StatusPanel>
  );
}

function InvalidPanel({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <StatusPanel icon="alert-circle" title="Invalid QR Code" tone="danger">
      <Text style={styles.panelText}>{error ?? 'Scanned code could not be parsed.'}</Text>
      <AppButton
        title="Try Again"
        onPress={onRetry}
        variant="primary"
        icon={<Ionicons name="refresh-outline" size={18} color={colors.surface} />}
        style={{ marginTop: spacing.xl }}
      />
    </StatusPanel>
  );
}

function StatusPanel({
  children,
  icon,
  title,
  tone = 'success',
}: {
  children: ReactNode;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  tone?: 'success' | 'danger';
}) {
  const iconColor = tone === 'danger' ? colors.danger : colors.success;
  const iconBg = tone === 'danger' ? 'rgba(240, 68, 56, 0.08)' : 'rgba(22, 199, 132, 0.08)';

  return (
    <AppCard bordered style={styles.statusContentCard}>
      <View style={[styles.statusIconContainer, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={28} color={iconColor} />
      </View>
      <Text style={styles.statusPanelTitle}>{title}</Text>
      {children}
    </AppCard>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function OptionButton({
  title,
  description,
  icon,
  onPress,
}: {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.optionButton, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.optionIcon}>
        <Ionicons name={icon} size={20} color={colors.ink} />
      </View>
      <View style={styles.optionTextWrap}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function ActionStack({
  onScanAnother,
  onBackToDashboard,
  onViewHistory,
}: {
  onScanAnother: () => void;
  onBackToDashboard?: () => void;
  onViewHistory?: () => void;
}) {
  return (
    <View style={styles.actionStack}>
      <AppButton
        title="Scan Another"
        onPress={onScanAnother}
        variant="primary"
        icon={<Ionicons name="scan-outline" size={18} color={colors.surface} />}
        style={{ marginTop: spacing.lg }}
      />
      {onViewHistory && (
        <AppButton
          title="View History"
          onPress={onViewHistory}
          variant="light"
          icon={<Ionicons name="time-outline" size={18} color={colors.ink} />}
          style={{ marginTop: spacing.md }}
        />
      )}
      {onBackToDashboard && (
        <AppButton
          title="Back to Dashboard"
          onPress={onBackToDashboard}
          variant="outline"
          icon={<Ionicons name="grid-outline" size={18} color={colors.ink} />}
          style={{ marginTop: spacing.md }}
        />
      )}
    </View>
  );
}

function SmallDebugButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.debugButton, pressed && styles.pressed]} onPress={onPress}>
      <Ionicons name="bug-outline" size={14} color={colors.mutedDark} />
      <Text style={styles.debugButtonText}>Use Demo Payload</Text>
    </Pressable>
  );
}

function shortenPublicKey(publicKey: string) {
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
}

function formatCreatedAt(createdAt: string) {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }

  return date.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + spacing.md : spacing.md,
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
  scannerContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  resultContent: {
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xxl,
    width: '100%',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  headerCloseButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.soft,
  },
  headerAvatarContainer: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  headerCopy: {
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.title,
    fontSize: 22,
    lineHeight: 26,
    color: colors.ink,
    fontWeight: '900',
  },
  keyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyPillDisconnected: {
    borderColor: 'rgba(240, 68, 56, 0.2)',
    backgroundColor: 'rgba(240, 68, 56, 0.04)',
  },
  keyPillText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
  },
  cameraFrame: {
    width: '100%',
    maxWidth: 320,
    alignSelf: 'center',
    aspectRatio: 1,
    borderRadius: radius.xxl,
    overflow: 'hidden',
    ...shadows.card,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: colors.success,
  },
  cornerTopLeft: {
    top: spacing.lg,
    left: spacing.lg,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: radius.sm,
  },
  cornerTopRight: {
    top: spacing.lg,
    right: spacing.lg,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: radius.sm,
  },
  cornerBottomLeft: {
    bottom: spacing.lg,
    left: spacing.lg,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: radius.sm,
  },
  cornerBottomRight: {
    right: spacing.lg,
    bottom: spacing.lg,
    borderRightWidth: 5,
    borderBottomWidth: 5,
    borderBottomRightRadius: radius.sm,
  },
  scanInstruction: {
    ...typography.body,
    fontWeight: '700',
    color: colors.inkSoft,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  debugActions: {
    width: '100%',
    gap: spacing.md,
    marginTop: spacing.xxl,
  },
  debugButton: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.lg,
  },
  debugButtonText: {
    color: colors.mutedDark,
    fontSize: 11,
    fontWeight: '800',
  },
  scanAgainButton: {
    borderRadius: radius.xl,
  },
  permissionCard: {
    width: '100%',
    padding: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  panelButton: {
    width: '100%',
    marginTop: spacing.xl,
    borderRadius: radius.xl,
  },
  paymentCard: {
    padding: spacing.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  resultTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  resultEyebrow: {
    color: colors.muted,
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 1,
  },
  resultAmount: {
    color: colors.ink,
    fontSize: 38,
    fontWeight: '900',
    marginTop: spacing.xs,
    letterSpacing: -0.5,
  },
  readyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(22, 199, 132, 0.12)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  readyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  readyText: {
    color: colors.success,
    fontSize: 9,
    fontWeight: '900',
  },
  demoBadgeContainer: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  demoBadge: {
    color: colors.mutedDark,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentSummary: {
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: '700',
  },
  detailValue: {
    ...typography.body,
    fontSize: 13,
    color: colors.ink,
    fontWeight: '800',
  },
  mvpNotice: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
    fontWeight: '700',
    marginTop: spacing.md,
  },
  optionStack: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  optionButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.soft,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8, 9, 10, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTextWrap: {
    flex: 1,
  },
  optionTitle: {
    ...typography.body,
    fontWeight: '800',
    color: colors.ink,
  },
  optionDescription: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
    fontWeight: '500',
  },
  bottomScanAnother: {
    marginTop: spacing.xxl,
    borderRadius: radius.xl,
  },
  statusContentCard: {
    width: '100%',
    padding: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  statusIconContainer: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  statusPanelTitle: {
    ...typography.title,
    fontSize: 20,
    fontWeight: '900',
    color: colors.ink,
    textAlign: 'center',
  },
  panelText: {
    ...typography.body,
    fontSize: 14,
    color: colors.mutedDark,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  smsBodyBox: {
    width: '100%',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  smsBodyLabel: {
    color: colors.muted,
    fontWeight: '900',
    fontSize: 9,
    letterSpacing: 1.2,
  },
  smsBodyText: {
    color: colors.ink,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  statusMessageText: {
    ...typography.caption,
    color: colors.inkSoft,
    textAlign: 'center',
    marginTop: spacing.md,
    fontWeight: '700',
  },
  queueCountBadge: {
    backgroundColor: 'rgba(8, 9, 10, 0.05)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginTop: spacing.xl,
  },
  queueCountText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  actionStack: {
    width: '100%',
    marginTop: spacing.xl,
  },
  subtleCloseButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  subtleCloseText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  headerLogoutButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  fixedNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
});
