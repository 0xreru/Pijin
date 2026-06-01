import { StrKey } from '@stellar/stellar-base';
import SignClient from '@walletconnect/sign-client';
import type { SessionTypes } from '@walletconnect/types';
import { Linking } from 'react-native';

declare const process: {
  env: Record<string, string | undefined>;
};

function cleanEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/^['"]|['"]$/g, '');
}

const STELLAR_CHAIN =
  cleanEnv(process.env.EXPO_PUBLIC_STELLAR_WALLET_CHAIN) ?? 'stellar:pubnet';
const WALLETCONNECT_RELAY_URL =
  cleanEnv(process.env.EXPO_PUBLIC_WALLETCONNECT_RELAY_URL) ?? 'wss://relay.walletconnect.com';
const WALLETCONNECT_SIGN_DEEPLINK = 'lobstr://';
const WALLET_SIGN_OPEN_STRATEGY = 'v2026-05-23-force-lobstr-root';
const STELLAR_SIGN_METHOD = 'stellar_signXDR';
const APPROVAL_TIMEOUT_MS = 30000;
const SIGN_DEDUP_WINDOW_MS = 8000;

let signClientPromise: Promise<SignClient> | null = null;
let activeSessionTopic: string | null = null;
let activeSignRequest: Promise<string> | null = null;
let lastSignFingerprint = '';
let lastSignAtMs = 0;
let lastWalletOpenAtMs = 0;

export type WalletConnectionResult = {
  publicKey: string;
  walletName: string;
};

export type ConnectedStellarWallet = WalletConnectionResult;

type DeepLinkStatus = {
  canOpen: boolean;
  opened: boolean;
  error?: string;
};

export type ConnectStellarWalletOptions = {
  onPairingUri?: (uri: string) => void;
  onDeepLinkStatus?: (status: DeepLinkStatus) => void;
};

export async function connectStellarWallet(
  options?: ConnectStellarWalletOptions
): Promise<WalletConnectionResult> {
  const client = await getSignClient();
  await pruneDuplicateStellarSessions(client);
  await cleanupStellarPairings(client);

  const existingSession = getExistingStellarSession(client);
  if (existingSession) {
    activeSessionTopic = existingSession.topic;
    const publicKey = extractStellarPublicKey(existingSession);
    return {
      publicKey,
      walletName: existingSession.peer.metadata.name || 'WalletConnect wallet',
    };
  }

  try {
    const { uri, approval } = await client.connect({
      optionalNamespaces: {
        stellar: {
          methods: [STELLAR_SIGN_METHOD],
          chains: [STELLAR_CHAIN],
          events: [],
        },
      },
    });

    if (!uri) {
      throw new Error('WalletConnect did not return a connection URI.');
    }

    options?.onPairingUri?.(uri);
    await openWalletConnectUri(uri, options?.onDeepLinkStatus);

    const session = await withTimeout(
      approval(),
      APPROVAL_TIMEOUT_MS,
      'Wallet approval timed out. Please try connecting again.'
    );
    const publicKey = extractStellarPublicKey(session);
    activeSessionTopic = session.topic;

    return {
      publicKey,
      walletName: session.peer.metadata.name || 'WalletConnect wallet',
    };
  } catch (error) {
    throw normalizeWalletError(error);
  }
}

async function getSignClient(): Promise<SignClient> {
  if (!signClientPromise) {
    console.log('[wallet-sign] strategy-loaded', { strategy: WALLET_SIGN_OPEN_STRATEGY });
    const projectId = cleanEnv(process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID);

    if (!projectId) {
      throw new Error('Missing EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID.');
    }

    signClientPromise = SignClient.init({
      projectId,
      relayUrl: WALLETCONNECT_RELAY_URL,
      logger: 'fatal',
      metadata: {
        name: 'AbotPera',
        description: 'AbotPera mobile wallet connection',
        url: 'https://abotpera.app',
        icons: [],
        redirect: {
          native: 'abotpera://',
        },
      },
    }).then((client) => {
      client.on('session_delete', ({ topic }) => {
        if (activeSessionTopic === topic) {
          activeSessionTopic = null;
          activeSignRequest = null;
        }
      });
      client.on('session_expire', ({ topic }) => {
        if (activeSessionTopic === topic) {
          activeSessionTopic = null;
          activeSignRequest = null;
        }
      });
      client.on('session_request_expire', () => {
        activeSignRequest = null;
      });

      const existingSession = getExistingStellarSession(client);
      if (existingSession) {
        activeSessionTopic = existingSession.topic;
      }
      return client;
    });
  }

  return signClientPromise;
}

function getExistingStellarSession(client: SignClient): SessionTypes.Struct | null {
  const sessions = client.session.getAll();
  for (const session of sessions) {
    const accounts = session.namespaces.stellar?.accounts ?? [];
    if (accounts.some((account) => account.startsWith(`${STELLAR_CHAIN}:`))) {
      return session;
    }
  }
  return null;
}

function getActiveSession(client: SignClient): SessionTypes.Struct | null {
  if (!activeSessionTopic) return null;
  try {
    return client.session.get(activeSessionTopic);
  } catch {
    return null;
  }
}

async function openWalletConnectUri(
  uri: string,
  onDeepLinkStatus?: (status: DeepLinkStatus) => void
) {
  const uriDiagnostics = {
    scheme: getUriScheme(uri),
    length: uri.length,
  };

  try {
    try {
      await Linking.openURL(uri);
      console.log('WalletConnect openURL succeeded:', uriDiagnostics);
      onDeepLinkStatus?.({ canOpen: true, opened: true });
    } catch (error) {
      const message = getErrorMessage(
        error,
        'Unable to open wallet app. Please switch to your wallet and approve the connection.'
      );
      console.log('WalletConnect openURL failed:', {
        ...uriDiagnostics,
        error: message,
      });
      onDeepLinkStatus?.({ canOpen: false, opened: false, error: message });
    }
  } catch (error) {
    const message = getErrorMessage(error, 'Unable to process wallet routing payload.');
    console.log('WalletConnect routing infrastructure failed:', {
      ...uriDiagnostics,
      error: message,
    });
    onDeepLinkStatus?.({ canOpen: false, opened: false, error: message });
  }
}

async function openWalletForSignature(client: SignClient) {
  const now = Date.now();
  if (now - lastWalletOpenAtMs < 1200) {
    return;
  }
  lastWalletOpenAtMs = now;

  try {
    await Linking.openURL(WALLETCONNECT_SIGN_DEEPLINK);
    console.log('[wallet-sign] opened-wallet', {
      uri: WALLETCONNECT_SIGN_DEEPLINK,
      strategy: WALLET_SIGN_OPEN_STRATEGY,
    });
  } catch (error) {
    const lastError = getErrorMessage(error, 'Unknown deep link error');
    console.log('[wallet-sign] open-wallet-failed', {
      uri: WALLETCONNECT_SIGN_DEEPLINK,
      strategy: WALLET_SIGN_OPEN_STRATEGY,
      error: lastError,
    });
    throw new Error(lastError || 'Unable to open Lobstr deep link.');
  }
}

function getUriScheme(uri: string) {
  const schemeEnd = uri.indexOf(':');
  return schemeEnd > -1 ? `${uri.slice(0, schemeEnd)}:` : 'unknown';
}

export async function signTransactionXdr(
  unsignedXdr: string,
  publicKey: string,
  _networkPassphrase?: string
): Promise<string> {
  if (activeSignRequest) {
    throw new Error('Signature request already in progress. Approve or reject it in Lobstr.');
  }

  const signPromise = signTransactionXdrInternal(unsignedXdr, publicKey);
  activeSignRequest = signPromise;
  try {
    return await signPromise;
  } finally {
    activeSignRequest = null;
  }
}

export function clearPendingSignatureLock() {
  activeSignRequest = null;
}

async function signTransactionXdrInternal(
  unsignedXdr: string,
  publicKey: string
): Promise<string> {
  const startedAt = Date.now();
  const client = await getSignClient();
  await cleanupStellarPairings(client);
  if (!activeSessionTopic) {
    throw new Error('Connect your wallet before signing a transaction.');
  }

  const pending = client.getPendingSessionRequests?.() ?? [];
  console.log('[wallet-sign] pending-before', { count: pending.length });
  const hasPendingForTopic = pending.some((request: { topic?: string }) => request.topic === activeSessionTopic);
  if (hasPendingForTopic) {
    activeSignRequest = null;
    throw new Error('Previous wallet request still pending. Open Lobstr and clear it, then retry.');
  }

  const unsigned = normalizeXdr(unsignedXdr);
  const session = getActiveSession(client);
  if (!session) {
    throw new Error('Wallet session expired. Reconnect Lobstr and try again.');
  }
  const sessionPublicKey = extractStellarPublicKey(session);
  if (sessionPublicKey !== publicKey) {
    throw new Error(
      `Connected wallet key mismatch. Expected ${publicKey.slice(0, 8)}..., got ${sessionPublicKey.slice(0, 8)}...`
    );
  }
  const activeChain = getSessionChain(session) ?? STELLAR_CHAIN;
  const fingerprint = `${activeSessionTopic}:${unsigned.slice(0, 64)}:${unsigned.length}`;
  const now = Date.now();
  if (fingerprint === lastSignFingerprint && now - lastSignAtMs < SIGN_DEDUP_WINDOW_MS) {
    throw new Error('Duplicate signature request blocked. Please wait a few seconds and retry.');
  }
  lastSignFingerprint = fingerprint;
  lastSignAtMs = now;
  console.log('[wallet-sign] request-created', {
    topic: activeSessionTopic,
    chainId: activeChain,
    xdrLen: unsigned.length,
  });

  const requestPayload = {
    topic: activeSessionTopic,
    chainId: activeChain,
    request: {
      method: STELLAR_SIGN_METHOD,
      params: {
        xdr: unsigned,
      },
    },
  };

  const requestPromise = withTimeout(
    client.request(requestPayload),
    APPROVAL_TIMEOUT_MS,
    'Wallet signature timed out. Open Lobstr and approve the request.'
  );
  openWalletForSignature(client).catch(() => {
    console.log('Unable to foreground wallet app for signing request.');
  });

  const response = await requestPromise;
  console.log('[wallet-sign] response-received', {
    elapsedMs: Date.now() - startedAt,
    topic: activeSessionTopic,
  });

  const signedRaw = extractSignedXdr(response);
  const signed = normalizeXdr(signedRaw);
  Linking.openURL('abotpera://').catch(() => {
    // Keep silent, app may already be foreground.
  });

  return signed;
}

async function pruneDuplicateStellarSessions(client: SignClient) {
  const sessions = client.session
    .getAll()
    .filter((session) =>
      (session.namespaces.stellar?.accounts ?? []).some((account) =>
        account.startsWith(`${STELLAR_CHAIN}:`)
      )
    );

  if (sessions.length <= 1) {
    return;
  }

  // Keep the most recently-expiring session, disconnect others.
  const sorted = [...sessions].sort((a, b) => (b.expiry ?? 0) - (a.expiry ?? 0));
  const keep = sorted[0].topic;
  const reason = { code: 6000, message: 'Pruned duplicate WalletConnect session' };

  for (const session of sorted.slice(1)) {
    try {
      await client.disconnect({ topic: session.topic, reason } as any);
    } catch {
      // Best effort cleanup.
    }
  }

  if (activeSessionTopic && activeSessionTopic !== keep) {
    activeSessionTopic = keep;
  }
}

async function cleanupStellarPairings(client: SignClient) {
  const pairings = client.core.pairing.getPairings();
  if (!pairings.length) return;

  const keepTopics = new Set<string>();
  for (const session of client.session.getAll()) {
    if (session.pairingTopic) {
      keepTopics.add(session.pairingTopic);
    }
  }

  for (const pairing of pairings) {
    const isExpired = (pairing.expiry ?? 0) * 1000 < Date.now();
    const isOrphan = !keepTopics.has(pairing.topic);
    const shouldRemove = isExpired || isOrphan;
    if (!shouldRemove) continue;

    try {
      await client.core.pairing.disconnect({ topic: pairing.topic });
    } catch {
      // Best effort cleanup.
    }
  }
}

function extractSignedXdr(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (typeof result === 'object' && result !== null) {
    const value = result as { signedXDR?: unknown; signedXdr?: unknown; xdr?: unknown };
    const signed = value.signedXDR ?? value.signedXdr ?? value.xdr;
    if (typeof signed === 'string') {
      return signed;
    }
  }

  throw new Error('Wallet did not return a signed transaction.');
}

function normalizeXdr(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Wallet returned non-string XDR payload.');
  }

  const cleaned = value.trim().replace(/^xdr:/i, '');
  if (!cleaned) {
    throw new Error('Wallet returned empty XDR payload.');
  }

  return cleaned;
}

function extractStellarPublicKey(session: SessionTypes.Struct) {
  const account = session.namespaces.stellar?.accounts.find((value) =>
    value.startsWith(`${STELLAR_CHAIN}:`)
  );

  if (!account) {
    throw new Error('The connected wallet did not return a Stellar public account.');
  }

  const publicKey = account.split(':')[2];

  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('The connected wallet returned an invalid Stellar public key.');
  }

  return publicKey;
}

function getSessionChain(session: SessionTypes.Struct | null): string | null {
  if (!session) return null;
  const account = session.namespaces.stellar?.accounts?.[0];
  if (!account) return null;
  const [namespace, reference] = account.split(':');
  if (!namespace || !reference) return null;
  return `${namespace}:${reference}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

function normalizeWalletError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String((error as { message?: unknown }).message);
    return new Error(message || 'Wallet connection was cancelled or rejected.');
  }

  return new Error('Wallet connection was cancelled or rejected.');
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String((error as { message?: unknown }).message);
    return message || fallback;
  }

  return fallback;
}
