import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

/**
 * Formats an E.164 phone number for display.
 *
 * Examples:
 *   "+639123456789" → "+63 912 345 6789"
 *   "+12125551234"  → "+1 (212) 555-1234"
 *
 * Falls back gracefully for legacy 10-digit local numbers that were stored
 * before the E.164 migration (returns the raw value as-is).
 */
export function formatE164ForDisplay(e164: string): string {
  if (!e164) return '';
  try {
    if (isValidPhoneNumber(e164)) {
      return parsePhoneNumber(e164).formatInternational();
    }
    // If it doesn't start with '+', attempt to add it and retry
    const withPlus = e164.startsWith('+') ? e164 : `+${e164}`;
    if (isValidPhoneNumber(withPlus)) {
      return parsePhoneNumber(withPlus).formatInternational();
    }
    return e164;
  } catch {
    return e164;
  }
}
