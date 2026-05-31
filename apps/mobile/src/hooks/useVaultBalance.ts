import { useCallback, useEffect, useState } from 'react';
import { getVaultBalance } from '../services/api/vault';
import { stroopsToXlm } from '../constants/stellar';

export function useVaultBalance(shortId?: string, stellarPublicKey?: string) {
  const [balancePhp, setBalancePhp] = useState<number | null>(null);
  const [balanceXlm, setBalanceXlm] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!shortId && !stellarPublicKey) {
      setBalancePhp(null);
      setBalanceXlm(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await getVaultBalance(
        stellarPublicKey ? { stellarPublicKey } : { shortId: shortId! }
      );
      setBalancePhp(result.balancePHP);
      setBalanceXlm(stroopsToXlm(result.balanceStroops));
    } catch (err) {
      setBalancePhp(null);
      setBalanceXlm(null);
      setError(err instanceof Error ? err.message : 'Unable to load vault balance.');
    } finally {
      setIsLoading(false);
    }
  }, [shortId, stellarPublicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balancePhp, balanceXlm, isLoading, error, refresh };
}
