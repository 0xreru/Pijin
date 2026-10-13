import { useEffect } from 'react';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';

const SECURE_SCREEN_KEY = 'pijin-secure-screen';

/**
 * Blocks screenshots / screen recording / the recents thumbnail (Android FLAG_SECURE,
 * iOS capture blocking) while `active` is true and the component is mounted.
 * Use on screens that display or accept the wallet seed phrase.
 */
export function useSecureScreen(active = true): void {
  useEffect(() => {
    if (!active) return;
    preventScreenCaptureAsync(SECURE_SCREEN_KEY).catch(() => {});
    return () => {
      allowScreenCaptureAsync(SECURE_SCREEN_KEY).catch(() => {});
    };
  }, [active]);
}
