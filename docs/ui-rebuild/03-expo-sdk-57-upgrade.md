# Expo SDK 54 to 57 upgrade

| | Before | After |
|---|---|---|
| Expo | 54.0.x | 57.0.31 |
| React Native | 0.81.5 | 0.86.3 (includes the Hermes V1 memory fix, needs expo >= 57.0.9) |
| React | 19.1.0 | 19.2.3 (root `overrides` and `apps/backend` updated to match) |
| TypeScript | 5.9 | 6.0.x (Expo's expected version) |

Done with `npx expo install expo@^57.0.0 --fix`, plus `expo install expo-splash-screen`.

## Config changes
- Removed `newArchEnabled` (removed from the schema in SDK 55; New Architecture is the only one).
- Moved top-level `splash` into the `expo-splash-screen` plugin (new dependency).
- Expo added the `expo-image`, `expo-sharing` and `expo-status-bar` config plugins.

## Checked (no device)
- `npx expo-doctor`: 21/21 pass.
- `npx tsc --noEmit` (mobile): 0 errors. Backend: 0 errors (after `prisma generate`).
- `npx expo export --platform android`: bundles to Hermes bytecode (1420 modules, 4.2 MB). The custom Metro aliases (Stellar SDK, react-native-svg, pijin_core, buffer/url polyfills) still resolve.

## Not checked, do on a device (release build, low-end Android and iOS)
1. **Hermes V1 is the default since SDK 56.** The wallet runs Stellar SDK, ed25519, bip39 and WalletConnect on it. Check wallet create/restore, signing, QR/SMS payload generation and memory on a low-end phone. Opt out with `useHermesV1: false` in `expo-build-properties` if anything misbehaves.
2. **`fetch` is now `expo/fetch` globally.** `services/api/client.ts` uses `fetch` with `AbortController`. Set `EXPO_PUBLIC_USE_RN_FETCH=1` to go back to the React Native fetch if requests misbehave.
3. **Native rebuild needed.** The project uses managed config (no `android/` or `ios/` folders), so make a new dev client / EAS build. Expo Go does not apply.
4. **iOS:** SDK 56+ requires Xcode 26.4 and iOS 16.4 or newer. iOS 27 builds need `ios.enableSceneSupport` (see the SDK 57 changelog); SDK 58 turns it on by default.
5. **`react-native-worklets` (0.10.1)** is installed but nothing imports it and Reanimated is not installed. Add Reanimated when the v2 design needs it, or remove worklets.
6. **`expo-media-library` old API is deprecated** (still works). It is used for saving the payment QR to the gallery in the old UI.
7. **CI:** `mobile-ci.yml` uses Node `20` (floating); RN 0.86 needs Node >= 20.19.4.

## Not done
SDK 58 (RN 0.88) was released 2026-10-15. Revisit after its first patch releases.
