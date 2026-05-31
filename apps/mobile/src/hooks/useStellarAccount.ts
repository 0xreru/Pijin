import { useCallback, useEffect, useState } from 'react';
import {
  getRecentStellarPayments,
  getStellarAccountSummary,
  StellarAccountSummary,
  StellarPaymentSummary,
} from '../services/stellar/stellarAccountService';

export function useStellarAccount(publicKey?: string | null) {
  const [account, setAccount] = useState<StellarAccountSummary | null>(null);
  const [recentPayments, setRecentPayments] = useState<StellarPaymentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setAccount(null);
      setRecentPayments([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const summary = await getStellarAccountSummary(publicKey);
      setAccount(summary);

      if (summary.exists) {
        setRecentPayments(await getRecentStellarPayments(publicKey));
      } else {
        setRecentPayments([]);
      }
    } catch (fetchError) {
      setAccount(null);
      setRecentPayments([]);
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load Stellar account.');
    } finally {
      setIsLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    account,
    recentPayments,
    isLoading,
    error,
    refresh,
  };
}

