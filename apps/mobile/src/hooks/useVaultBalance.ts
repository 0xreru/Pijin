import { useCallback, useEffect, useState } from 'react';
import { getVaultBalance } from '../services/api/vault';
import { stroopsToXlm } from '../constants/stellar';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function useVaultBalance(shortId?: string, stellarPublicKey?: string) {
  const [balancePhp, setBalancePhp] = useState<number | null>(null);
  const [balanceXlm, setBalanceXlm] = useState<number | null>(null);
  const [resolvedShortId, setResolvedShortId] = useState<string | null>(null);
  const [offlineBalancePhp, setOfflineBalancePhp] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const refresh = useCallback(async () => {
    if (!shortId && !stellarPublicKey) {
      console.log('[useVaultBalance] Skipping refresh: no shortId or stellarPublicKey provided.');
      setBalancePhp(null);
      setBalanceXlm(null);
      setResolvedShortId(null);
      setOfflineBalancePhp(null);
      setError(null);
      setIsOffline(false);
      return;
    }

    console.log(
      `[useVaultBalance] Starting refresh | shortId=${shortId ?? 'N/A'} | stellarPublicKey=${stellarPublicKey ?? 'N/A'}`
    );
    setIsLoading(true);
    setError(null);
    setIsOffline(false);
    const startTime = Date.now();

    try {
      const queryParams = stellarPublicKey ? { stellarPublicKey } : { shortId: shortId! };
      const result = await getVaultBalance(queryParams);
      const duration = Date.now() - startTime;

      console.log(
        `[useVaultBalance] API response success | duration=${duration}ms | ` +
        `balancePHP=${result.balancePHP} | offlineBalancePHP=${result.offlineBalancePHP ?? 0} | ` +
        `balanceStroops=${result.balanceStroops} | shortId=${result.shortId} | ` +
        `stellarPublicKey=${result.stellarPublicKey}`
      );

      setBalancePhp(result.balancePHP);
      setBalanceXlm(stroopsToXlm(result.balanceStroops));
      setResolvedShortId(result.shortId);
      setOfflineBalancePhp(result.offlineBalancePHP ?? 0);
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : 'Unable to load vault balance.';
      
      const isNetworkError = errorMessage.toLowerCase().includes('network') || errorMessage.toLowerCase().includes('fetch');

      if (isNetworkError) {
        console.warn(`[useVaultBalance] Offline mode detected after ${duration}ms: ${errorMessage}`);
        setIsOffline(true);
        
        // Attempt to retrieve last known balances from AsyncStorage
        try {
          const cachedOnline = await AsyncStorage.getItem('pijn.cached_balance');
          const cachedOffline = await AsyncStorage.getItem('pijn.offline_balance');
          
          if (cachedOnline) setBalancePhp(parseFloat(cachedOnline));
          if (cachedOffline) setOfflineBalancePhp(parseFloat(cachedOffline));
        } catch (e) {
          console.warn('[useVaultBalance] Failed to load cached balances:', e);
        }
      } else {
        console.error(`[useVaultBalance] API request failed after ${duration}ms:`, errorMessage, err);
        setBalancePhp(null);
        setBalanceXlm(null);
        setOfflineBalancePhp(null);
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  }, [shortId, stellarPublicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balancePhp, balanceXlm, resolvedShortId, offlineBalancePhp, isLoading, error, refresh, isOffline };
}
