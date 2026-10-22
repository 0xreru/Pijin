import { useCallback, useEffect, useRef, useState } from 'react';
import { getUserPhone } from '../../services/storage/onboardingStorage';
import { useAuth } from '../../context/AuthContext';
import { attemptSignIn, type SignInResult } from './signIn';

const PIN_LENGTH = 4;
const SUBMIT_DELAY_MS = 150;

/**
 * State and actions for PIN sign-in. No UI: the screen renders `pin` and
 * `isValidating` and reacts to each `SignInResult` via `onResult`.
 */
export function useSignIn(onResult: (result: SignInResult, phoneNumber: string) => void) {
  const { login } = useAuth();
  const [pin, setPin] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    getUserPhone()
      .then((stored) => {
        if (stored && mounted.current) setPhoneNumber(stored);
      })
      .catch((e) => console.error('Failed to load stored user phone:', e));
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const submit = useCallback(
    async (enteredPin: string) => {
      setIsValidating(true);
      const result = await attemptSignIn({ pin: enteredPin, phoneNumber, login });
      if (!mounted.current) return;
      setIsValidating(false);
      if (result.status !== 'success' && result.status !== 'needs_restore') setPin('');
      onResult(result, phoneNumber);
    },
    [phoneNumber, login, onResult],
  );

  const pressDigit = useCallback(
    (digit: string) => {
      if (isValidating || pin.length >= PIN_LENGTH) return;
      const next = pin + digit;
      setPin(next);
      if (next.length === PIN_LENGTH) {
        timer.current = setTimeout(() => submit(next), SUBMIT_DELAY_MS);
      }
    },
    [isValidating, pin, submit],
  );

  const backspace = useCallback(() => setPin((prev) => prev.slice(0, -1)), []);

  return { pin, phoneNumber, isValidating, pressDigit, backspace };
}
