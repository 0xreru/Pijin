# Release, Testing & Platform Reference

Contents: Dev workflow · Verifying release builds · Testing strategy · Android vs iOS quirks · Crash / ANR triage · Pre-release checklist

## Dev workflow (Expo)

- Native deps or config-plugin changes → new **dev client** build (`expo run:android` / `expo run:ios` or EAS `development` profile). JS-only changes → Metro reload.
- Stale-cache symptoms (phantom errors, old code): `expo start -c`; for Android native weirdness clean Gradle (`cd android && gradlew clean`). Prefer fixing root cause over habitual cache clears.
- USB Android devices: `adb reverse tcp:8081 tcp:8081` so the device reaches Metro.
- `npx expo-doctor` and `npx expo install --check` catch SDK/library version mismatches — run after upgrades.
- Keep `eas.json` profiles: `development` (dev client), `preview` (internal, release-like), `production` (store). Test performance on `preview`.

## Verifying a release-like build

Dev mode lies. Before concluding anything about speed:

- Android: `expo run:android --variant release` (or EAS `preview`), on a physical mid/low-end device.
- iOS: `expo run:ios --configuration Release`.
- Confirm Hermes is on, minification on, dev warnings off, `console.*` stripped.
- Compare before/after on the same device, same flow, ≥3 runs, discard the first (cold caches).

## Testing strategy

| Layer | Tool | What to cover |
|---|---|---|
| Pure logic / services / hooks | Jest (+ `@testing-library/react-hooks`/RNTL `renderHook`) | parsing, formatting, retry/queue logic, reducers, crypto wrappers |
| Components | React Native Testing Library | user-visible behavior (press, type, assert text), not implementation details |
| Flows | Maestro or Detox | login/onboarding, the money-critical or core path, offline → online recovery |
| Performance regression | Flashlight / manual perf budget | startup time, list FPS on a reference device |

Mock native modules at the boundary (secure store, NetInfo, camera). Keep tests deterministic: fake timers for backoff logic. For concurrency/queue code, test the interleavings (double-submit, reconnect mid-request).

## Android vs iOS quirks to check

| Area | Android | iOS |
|---|---|---|
| Back navigation | Hardware/gesture back must be handled | Swipe-back gesture; don't disable accidentally |
| Shadows | `elevation` only (no colored shadows pre-API 28) | `shadow*` props |
| Keyboard | `windowSoftInputMode`, resize behavior; may cover inputs | `KeyboardAvoidingView behavior="padding"` |
| Status/nav bars | Edge-to-edge (SDK 35+ enforced), translucent bars | Safe-area insets, notch/dynamic island |
| Permissions | Runtime, can be "don't ask again" → deep-link to settings | Single prompt; must have usage strings in Info.plist |
| Fonts/text | Font padding (`includeFontPadding`) differences | Dynamic Type scaling |
| Background | Aggressive OEM task killers; process death | Suspended quickly; limited background time |
| Text input | `autoComplete`/`textContentType` differ; `multiline` quirks | Autofill, password manager integration |
| WebView | Needs explicit settings for file access, mixed content | WKWebView, ITP/cookie rules |

## Crash / ANR triage

1. Get the **native** trace if it's a hard crash: `adb logcat` (filter `AndroidRuntime`, `ReactNativeJS`, `libhermes`) or Xcode device logs; JS red-box traces only cover JS errors.
2. "Works in dev, crashes in release": suspect minification/ProGuard stripping (add keep rules), missing polyfill order, Hermes-unsupported syntax/library, or a native module not autolinked in the release variant.
3. "Crashes only on some Android devices": low memory (images/lists), OEM quirks, 32-bit ABI missing, or unsupported API level (`minSdkVersion`).
4. "Crashes on launch after a package update": mismatched native/JS versions → rebuild the native app; run `expo-doctor`.
5. ANR: look for synchronous native I/O or heavy work on the main thread; get the thread dump from Play Console / `adb bugreport`.
6. Add the crash reporter (Sentry/Crashlytics) with source maps/symbol upload so release traces are readable.

## Pre-release checklist

- [ ] Release build tested on low-end Android + a recent iPhone
- [ ] Cold start time and list scroll FPS within budget
- [ ] Offline / flaky network / airplane-mode toggle mid-action handled
- [ ] App killed and restored mid-flow: state recovers, no double submissions
- [ ] Permissions denied path works
- [ ] Dark mode, large fonts, small screens, keyboard-open forms checked
- [ ] No secrets or debug logging in the bundle; production endpoints/keys
- [ ] R8/shrinking on, AAB size reviewed; source maps uploaded to crash reporter
- [ ] Versions/`versionCode`/`buildNumber` bumped; store privacy/data-safety answers match actual SDK usage
- [ ] Rollback plan (OTA channel / previous build) ready
