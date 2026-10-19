import * as Clipboard from 'expo-clipboard';

const CLEAR_AFTER_MS = 60_000;

let clearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Copies a secret (e.g. the seed phrase) and wipes the clipboard after ~60s.
 * The wipe only happens if the clipboard still holds this secret, so we never
 * erase something the user copied afterwards. Best effort: the timer can't fire
 * if the OS suspends the app.
 */
export async function copySecretToClipboard(secret: string): Promise<void> {
  await Clipboard.setStringAsync(secret);
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(async () => {
    clearTimer = null;
    try {
      if ((await Clipboard.getStringAsync()) === secret) {
        await Clipboard.setStringAsync('');
      }
    } catch {
      // Clipboard unavailable (e.g. app backgrounded on newer Android) — nothing to do.
    }
  }, CLEAR_AFTER_MS);
}
