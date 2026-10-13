import { useCallback, useEffect, useState } from 'react';
import { getVaultBalance } from '../services/api/vault';
import { stroopsToXlm } from '../constants/stellar';
import AsyncStorage from '@react-native-async-storage/async-storage';

type VaultBalance = Awaited<ReturnType<typeof getVaultBalance>>;

/** Mount-time reads reuse a result younger than this; explicit refresh() always refetches. */
const BALANCE_TTL_MS = 20_000;

const balanceCache = new Map<string, { result: VaultBalance; at: number }>();
const balanceInFlight = new Map<string, Promise<VaultBalance>>();

/** One network read per account at a time, shared by every hook instance (Dashboard + SendMoney). */
function fetchBalanceShared(key: string, params: Parameters<typeof getVaultBalance>[0]): Promise<VaultBalance> {
  const pending = balanceInFlight.get(key);
  if (pending) return pending;
  const request = getVaultBalance(params)
    .then((result) => {
      balanceCache.set(key, { result, at: Date.now() });
      return result;
    })
    .finally(() => balanceInFlight.delete(key));
  balanceInFlight.set(key, request);
  return request;
}

export function useVaultBalance(shortId?: string, stellarPublicKey?: string) {
  const [balancePhp, setBalancePhp] = useState<number | null>(null);
  const [balanceXlm, setBalanceXlm] = useState<number | null>(null);
  const [resolvedShortId, setResolvedShortId] = useState<string | null>(null);
  const [offlineBalancePhp, setOfflineBalancePhp] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const applyResult = useCallback((result: VaultBalance) => {
    setBalancePhp(result.balancePHP);
    setBalanceXlm(stroopsToXlm(result.balanceStroops));
    setResolvedShortId(result.shortId);
    setOfflineBalancePhp(result.offlineBalancePHP ?? 0);
  }, []);

  const load = useCallback(async (force: boolean) => {
    if (!shortId && !stellarPublicKey) {
      setBalancePhp(null);
      setBalanceXlm(null);
      setResolvedShortId(null);
      setOfflineBalancePhp(null);
      setError(null);
      setIsOffline(false);
      return;
    }

    const cacheKey = stellarPublicKey ?? shortId!;
    const cached = balanceCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < BALANCE_TTL_MS) {
      applyResult(cached.result);
      setError(null);
      setIsOffline(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setIsOffline(false);
    const startTime = Date.now();

    try {
      const queryParams = stellarPublicKey ? { stellarPublicKey } : { shortId: shortId! };
      const result = await fetchBalanceShared(cacheKey, queryParams);
      applyResult(result);
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
  }, [shortId, stellarPublicKey, applyResult]);

  // Explicit refresh (pull-to-refresh, after a payment) always hits the network.
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    load(false);
  }, [load]);

  return { balancePhp, balanceXlm, resolvedShortId, offlineBalancePhp, isLoading, error, refresh, isOffline };
}
