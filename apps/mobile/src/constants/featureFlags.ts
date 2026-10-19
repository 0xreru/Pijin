/**
 * Build-time feature flags.
 *
 * EXPO_PUBLIC_* values are inlined at bundle time, so changing one needs a
 * Metro restart (`npx expo start -c`) or a new EAS build.
 */

/**
 * Home-screen Top-Up button. Disabled unless EXPO_PUBLIC_TOPUP_ENABLED is
 * exactly "true" (set it in apps/mobile/.env, or in the env block of the
 * relevant profile in eas.json).
 */
export const TOPUP_ENABLED = process.env.EXPO_PUBLIC_TOPUP_ENABLED === 'true';
