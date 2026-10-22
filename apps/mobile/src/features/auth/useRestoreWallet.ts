import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  MNEMONIC_WORD_COUNT,
  normalizeMnemonic,
  restoreWalletFromPhrase,
  type RestoreResult,
} from './restoreWallet';

/** State and actions for restoring a wallet from a recovery phrase. No UI. */
export function useRestoreWallet(phoneNumber: string | undefined, onResult: (result: RestoreResult) => void) {
  const { login } = useAuth();
  const [phrase, setPhrase] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const restore = useCallback(async () => {
    if (normalizeMnemonic(phrase).split(' ').length !== MNEMONIC_WORD_COUNT) {
      onResult({ status: 'invalid_phrase' });
      return;
    }
    setIsRestoring(true);
    // Yield so the loading state paints before key derivation blocks the JS thread.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = await restoreWalletFromPhrase({ phrase, phoneNumber, login });
    if (!mounted.current) return;
    setIsRestoring(false);
    onResult(result);
  }, [phrase, phoneNumber, login, onResult]);

  return { phrase, setPhrase, isRestoring, restore };
}
