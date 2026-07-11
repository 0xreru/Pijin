/**
 * useJitTrustline.ts
 *
 * Custom hook that orchestrates the Just-in-Time trustline flow for Pijin.
 *
 * Consumers call `handleDepositClick(assetCode)` and supply an `onSuccess`
 * callback. The hook manages all async state and surfaces it through a clean
 * API so the UI component stays declarative.
 *
 * Flow:
 *  1. Silently fetch balances and check for an existing trustline.
 *  2. If trustline exists → call `onSuccess()` immediately.
 *  3. If missing → show overlay, build + sign + submit ChangeTrust tx,
 *     then call `onSuccess()` on confirmation.
 *  4. On any failure → surface a human-readable error string.
 */

import { useCallback, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import {
  AssetCode,
  TrustlineError,
  hasTrustline,
  ensureTrustline,
} from '../services/stellar/trustlineService';
import { getMainWalletSecret } from '../services/storage/onboardingStorage';

// ─── Types ───────────────────────────────────────────────────────────────────

export type JitPhase =
  | 'idle'
  | 'checking'       // silently loading balances
  | 'establishing'   // submitting ChangeTrust tx (overlay visible)
  | 'error';         // terminal error state

export interface UseJitTrustlineOptions {
  /** Called after the trustline is confirmed (or was already present). */
  onSuccess: (assetCode: AssetCode) => void;
  /** The user's Stellar public key. */
  publicKey: string | null | undefined;
  /**
   * Optional: supply an already-loaded main wallet keypair to skip SecureStore lookup.
   */
  keypair?: Keypair;
}

export interface UseJitTrustlineReturn {
  /** Current phase of the JIT flow. */
  phase: JitPhase;
  /** The asset currently being processed (null when idle/error). */
  activeAsset: AssetCode | null;
  /** Human-readable error message, set when `phase === 'error'`. */
  errorMessage: string | null;
  /** Trigger the JIT flow for the given asset. */
  handleDepositClick: (assetCode: AssetCode) => void;
  /** Dismiss the error state and return to idle. */
  dismissError: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useJitTrustline({
  onSuccess,
  publicKey,
  keypair: providedKeypair,
}: UseJitTrustlineOptions): UseJitTrustlineReturn {
  const [phase, setPhase] = useState<JitPhase>('idle');
  const [activeAsset, setActiveAsset] = useState<AssetCode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleDepositClick = useCallback(
    (assetCode: AssetCode) => {
      console.log('[JIT] 1. Button pressed — asset:', assetCode, '| publicKey:', publicKey ?? 'MISSING');

      if (!publicKey) {
        console.log('[JIT] ❌ Aborting — no publicKey');
        setPhase('error');
        setErrorMessage('No wallet connected. Please sign in first.');
        return;
      }

      console.log('[JIT] 2. Kicking off async JIT flow…');
      // Kick off the async flow without blocking the call site.
      void runJitFlow(assetCode);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publicKey, providedKeypair, onSuccess],
  );

  const runJitFlow = async (assetCode: AssetCode) => {
    console.log('[JIT] 3. runJitFlow started — setting phase=checking');
    setActiveAsset(assetCode);
    setErrorMessage(null);
    // Phase 1 — silently check balances (no overlay yet).
    setPhase('checking');

    try {
      // Resolve the keypair — prefer the prop, fall back to SecureStore.
      console.log('[JIT] 4. Resolving keypair…');
      const mainWalletSecret = providedKeypair ? null : await getMainWalletSecret();
      const keypair = providedKeypair ?? (mainWalletSecret ? Keypair.fromSecret(mainWalletSecret) : null);
      if (!keypair) {
        throw new Error('Main wallet not found. Please sign in again.');
      }
      console.log('[JIT] 5. Keypair resolved — publicKey:', keypair.publicKey());

      console.log('[JIT] 6. Calling hasTrustline on Horizon…');
      const alreadyTrusted = await hasTrustline(publicKey!, assetCode);
      console.log('[JIT] 7. hasTrustline result:', alreadyTrusted);

      if (alreadyTrusted) {
        // Trustline exists — go straight to success with no overlay.
        console.log('[JIT] ✅ Trustline already exists — calling onSuccess()');
        setPhase('idle');
        setActiveAsset(null);
        onSuccess(assetCode);
        return;
      }

      // Phase 2 — trustline missing: show overlay BEFORE the Horizon round-trip.
      console.log('[JIT] 8. No trustline — setting phase=establishing, calling ensureTrustline…');
      setPhase('establishing');

      // Build, sign, and submit the ChangeTrust transaction.
      const result = await ensureTrustline(publicKey!, keypair, assetCode);
      console.log('[JIT] 9. ensureTrustline done — status:', result.status);

      setPhase('idle');
      setActiveAsset(null);
      console.log('[JIT] ✅ Trustline established — calling onSuccess()');
      onSuccess(assetCode);
    } catch (err: unknown) {
      console.log('[JIT] ❌ Caught error in runJitFlow:', err);
      const message = resolveErrorMessage(err, assetCode);
      setPhase('error');
      setErrorMessage(message);
    }
  };

  const dismissError = useCallback(() => {
    setPhase('idle');
    setActiveAsset(null);
    setErrorMessage(null);
  }, []);

  return { phase, activeAsset, errorMessage, handleDepositClick, dismissError };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveErrorMessage(error: unknown, assetCode: AssetCode): string {
  if (error instanceof TrustlineError) {
    const detail = error.detail ? ` (${error.detail})` : '';
    return `${error.message}${detail}`;
  }
  if (error instanceof Error) {
    return error.message || `Could not set up ${assetCode} trustline.`;
  }
  return `An unexpected error occurred while preparing ${assetCode}.`;
}
