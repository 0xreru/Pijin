import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPinLockoutRemainingMs,
  getUserPin,
  recordPinFailure,
  resetPinAttempts,
  saveUserPin,
} from '../../services/storage/onboardingStorage';

const PIN_LENGTH = 4;
const SUBMIT_DELAY_MS = 150;

export type ChangePinStep = 'verify' | 'new' | 'confirm';

export type ChangePinEvent =
  | { type: 'locked'; minutes: number }
  | { type: 'wrong_current'; lockoutMinutes?: number }
  | { type: 'mismatch' }
  | { type: 'changed' };

/**
 * Three-step PIN change (verify current, enter new, confirm new). No UI: the
 * screen renders `pin`/`step` and presents each event via `onEvent`.
 */
export function useChangePin(onEvent: (event: ChangePinEvent) => void) {
  const [step, setStep] = useState<ChangePinStep>('verify');
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const processPin = useCallback(
    async (entered: string) => {
      if (step === 'verify') {
        const lockedMs = await getPinLockoutRemainingMs();
        if (lockedMs > 0) {
          onEvent({ type: 'locked', minutes: Math.ceil(lockedMs / 60000) });
          setPin('');
          return;
        }
        const currentPin = await getUserPin();
        if (entered === currentPin) {
          await resetPinAttempts();
          setStep('new');
        } else {
          const lockoutMs = await recordPinFailure();
          onEvent({ type: 'wrong_current', lockoutMinutes: lockoutMs > 0 ? Math.ceil(lockoutMs / 60000) : undefined });
        }
        setPin('');
      } else if (step === 'new') {
        setNewPin(entered);
        setStep('confirm');
        setPin('');
      } else if (entered === newPin) {
        await saveUserPin(entered);
        onEvent({ type: 'changed' });
      } else {
        onEvent({ type: 'mismatch' });
        setStep('new');
        setPin('');
        setNewPin('');
      }
    },
    [step, newPin, onEvent],
  );

  const pressDigit = useCallback(
    (digit: string) => {
      if (pin.length >= PIN_LENGTH) return;
      const next = pin + digit;
      setPin(next);
      if (next.length === PIN_LENGTH) {
        timer.current = setTimeout(() => processPin(next), SUBMIT_DELAY_MS);
      }
    },
    [pin, processPin],
  );

  const backspace = useCallback(() => setPin((prev) => prev.slice(0, -1)), []);

  return { step, pin, pressDigit, backspace };
}
