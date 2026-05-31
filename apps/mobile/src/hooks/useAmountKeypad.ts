import { useMemo, useState } from 'react';
import { KeypadKey } from '../types/funds';

export function useAmountKeypad(initialValue = '0') {
  const [rawAmount, setRawAmount] = useState(initialValue);

  const amount = useMemo(() => Number(rawAmount || 0), [rawAmount]);

  function pressKey(key: KeypadKey) {
    setRawAmount((current) => {
      if (key === 'backspace') {
        const next = current.slice(0, -1);
        return next.length ? next : '0';
      }

      if (key === '.') {
        return current.includes('.') ? current : `${current}.`;
      }

      const normalized = current === '0' ? key : `${current}${key}`;
      const [, decimals = ''] = normalized.split('.');
      return decimals.length > 2 ? current : normalized;
    });
  }

  function reset() {
    setRawAmount('0');
  }

  return {
    amount,
    displayAmount: rawAmount,
    pressKey,
    reset,
  };
}
