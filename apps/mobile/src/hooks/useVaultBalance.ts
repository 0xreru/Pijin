import { useCallback, useEffect, useState } from 'react';
import { getVaultBalance } from '../services/api/vault';
import { stroopsToXlm } from '../constants/stellar';

export function useVaultBalance(shortId?: string, stellarPublicKey?: string) {
  const [balancePhp, setBalancePhp] = useState<number | null>(null);
  const [balanceXlm, setBalanceXlm] = useState<number | null>(null);
  const [resolvedShortId, setResolvedShortId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!shortId && !stellarPublicKey) {
      console.log('[useVaultBalance] Skipping refresh: no shortId or stellarPublicKey provided.');
      setBalancePhp(null);
      setBalanceXlm(null);
      setResolvedShortId(null);
      setError(null);
      return;
    }

    console.log(
      `[useVaultBalance] Starting refresh | shortId=${shortId ?? 'N/A'} | stellarPublicKey=${stellarPublicKey ?? 'N/A'}`
    );
    setIsLoading(true);
    setError(null);
    const startTime = Date.now();

    try {
      const queryParams = stellarPublicKey ? { stellarPublicKey } : { shortId: shortId! };
      const result = await getVaultBalance(queryParams);
      const duration = Date.now() - startTime;

      console.log(
        `[useVaultBalance] API response success | duration=${duration}ms | ` +
        `balancePHP=${result.balancePHP} | balanceStroops=${result.balanceStroops} | ` +
        `shortId=${result.shortId} | stellarPublicKey=${result.stellarPublicKey}`
      );

      setBalancePhp(result.balancePHP);
      setBalanceXlm(stroopsToXlm(result.balanceStroops));
      setResolvedShortId(result.shortId);
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : 'Unable to load vault balance.';
      console.error(`[useVaultBalance] API request failed after ${duration}ms:`, errorMessage, err);
      
      setBalancePhp(null);
      setBalanceXlm(null);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [shortId, stellarPublicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balancePhp, balanceXlm, resolvedShortId, isLoading, error, refresh };
}
