# React Native Architecture Reference

Contents: Project structure · Navigation · State & data · Storage · Native modules & polyfills · Offline-first & resilience · Error handling · Accessibility

Match the repo first. These are defaults for when there's no established convention.

## Project structure

Group by feature, share only what's truly shared:

```
src/
  features/<feature>/ {screens, components, hooks, api, store, types}
  components/      # shared presentational pieces
  hooks/           # shared hooks
  services/        # api client, storage, analytics, native wrappers
  navigation/      # navigators + typed param lists
  theme/           # tokens: colors, spacing, typography
  utils/
```

Screens are thin: compose components + hooks. Business logic lives in hooks/services so it's testable without rendering. Domain/core logic that must be shared with other packages (e.g., a monorepo `core` package) should stay UI-free.

## Navigation (React Navigation)

- Type the param lists (`RootStackParamList`) and use typed `useNavigation`/`useRoute`.
- Pass ids, not whole objects, in params; params must be serializable.
- Native stack (`@react-navigation/native-stack`) over JS stack for performance and native transitions.
- Lazy-load heavy tabs/screens; `freezeOnBlur` (with `react-freeze`) for expensive background screens.
- Handle the Android back button explicitly for modals/flows with unsaved state (`BackHandler`, `beforeRemove`).
- Deep links: define a `linking` config early; validate params from untrusted links.
- Don't mount big navigators conditionally in ways that reset state unexpectedly (auth gate should switch navigators, not unmount providers).

## State & data

Choose by kind of state:

| State kind | Use |
|---|---|
| Local UI (toggle, input) | `useState`/`useReducer` in the leaf |
| Cross-screen client state | a small store (Zustand/Redux Toolkit/Jotai, or the repo's existing one) with selectors |
| Server data | a cache layer (TanStack Query or equivalent): dedupe, staleTime, retry, background refetch, abort on unmount |
| Persisted | storage layer (below), hydrate lazily |
| Reactive streams | RxJS/observables if already in the repo; always unsubscribe |

Guidelines: normalize large collections by id; keep derived data in selectors; never mirror server data into local state "just in case"; avoid putting high-frequency values in global state.

## Storage choices

| Need | Use |
|---|---|
| Secrets (keys, seed phrases, tokens) | `expo-secure-store` / Keychain / Keystore. Small values only; consider biometrics gating |
| Small non-sensitive prefs | MMKV (fast, sync) or AsyncStorage (async, slower, ~6MB Android default cap) |
| Structured/queryable data | SQLite (`expo-sqlite`, with Drizzle/other ORM if the repo uses it) — add indexes, paginate queries, batch writes in transactions |
| Files/media | `expo-file-system`; store paths, not blobs, in state |

Run migrations before first query but off the first-paint critical path when possible. Never log or persist secrets in plain storage.

## Native modules, polyfills, config plugins

- Prefer Expo SDK modules and well-maintained libraries over custom native code. Check New Architecture support.
- Anything with native code needs a rebuild (dev client / EAS), not a Metro reload — tell the user.
- Node-oriented libraries (crypto, Stellar/Bitcoin SDKs, buffers, URL, TextEncoder) need polyfills loaded **first** in `index.ts` (e.g., `react-native-get-random-values`, `buffer`, `react-native-url-polyfill`, `fast-text-encoding`). Order matters: random values before anything that calls `crypto`.
- Metro: use `resolver.extraNodeModules`/`resolveRequest` to stub Node built-ins (`empty-module.js` pattern) rather than patching libraries; for monorepos set `watchFolders` and `nodeModulesPaths`.
- Expose native/crypto work through a single service wrapper so it can be swapped for a faster native implementation later.
- Custom Expo config plugins over hand-editing `android/`/`ios/` when the project is managed/CNG.

## Offline-first & resilience

- Subscribe to connectivity with NetInfo, but treat it as a hint: the truth is whether requests succeed.
- Timeouts on every request; retry with exponential backoff + jitter for idempotent calls only; use idempotency keys for writes that retry.
- Queue user actions locally (persisted) when offline and replay on reconnect; show pending/failed state clearly in the UI.
- Reconnect logic for sockets/streams: backoff, resubscribe, resync from last-known cursor.
- Handle app lifecycle: `AppState` change → pause polling in background, refresh on foreground.
- Make long operations (signing, submitting a transaction, uploads) resumable and de-duplicated so a backgrounded/killed app can't double-submit.

## Error handling

- Root `ErrorBoundary` with a recoverable fallback screen; additional boundaries around risky widgets (WebView, camera, charts).
- Error boundaries don't catch async/event-handler errors — handle those explicitly and register `ErrorUtils.setGlobalHandler` / a crash reporter (Sentry or similar).
- User-facing errors are actionable ("No connection — retry"), not stack traces. Log details with context; scrub PII/secrets.

## Accessibility & UX baseline

- `accessibilityLabel`/`accessibilityRole` on touchables and icons-as-buttons; ≥44×44pt (48dp) hit targets (`hitSlop`).
- Respect system font scaling (test at 1.3×+); avoid fixed heights on text containers.
- Sufficient contrast in light/dark; honor `useColorScheme`.
- Provide loading skeletons, empty states and error states for every data screen.
- Use `KeyboardAvoidingView`/keyboard-controller consistently; test forms with the keyboard open on small Android screens.
- Haptics and motion modest; honor reduce-motion.
