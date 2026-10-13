# React Native Performance Reference

Contents: Profiling tools · Lists · Re-renders · Animation · Images · Startup · Bundle size · Memory · JS-thread work · Hermes & New Architecture · Android tuning · Quick-scan checklist

## Profiling tools (use the right one for the bottleneck)

| Symptom | Tool |
|---|---|
| Too many renders / slow commits | React DevTools Profiler (record, look at "why did this render"), "Highlight updates when components render" |
| FPS drop, JS vs UI thread | In-app Perf Monitor (Dev Menu → Perf Monitor) shows separate JS and UI FPS. JS low = JS-bound; UI low = native/draw-bound |
| JS CPU hot spots | Hermes sampling profiler (Dev Menu / RN DevTools → Profiler), load the `.cpuprofile` in Chrome DevTools |
| Android frame stats | `adb shell dumpsys gfxinfo <package> framestats`, Android Studio Profiler (CPU, memory), "Profile GPU rendering" |
| iOS | Xcode Instruments: Time Profiler, Allocations, Core Animation |
| Startup | `adb shell am start -W <package>/.MainActivity` (TotalTime/WaitTime); Hermes `console.time` markers around init; Android Studio startup profiling |
| Bundle size | `npx react-native-bundle-visualizer`, `npx expo export` + inspect output sizes, `source-map-explorer` |
| Memory | Android Studio Memory Profiler (heap dump), Xcode Allocations/Leaks, Hermes heap snapshot |

Rules: profile a **release** build on a **low/mid-range physical device**. Dev builds, simulators and flagship phones hide the problem. Change one thing, re-measure.

## Lists

Most real-world jank lives here.

- Prefer **FlashList** when available (recycling): provide `estimatedItemSize` (v1) and a `getItemType` for heterogeneous rows; avoid `key` on the row root inside `renderItem` (breaks recycling); don't keep local state in rows that must reset on recycle without handling it.
- **FlatList** tuning: `keyExtractor` returns stable IDs (never index for mutable lists); `getItemLayout` for fixed heights; `initialNumToRender` ≈ one screen; `windowSize` 5–9 (default 21 is memory heavy); `maxToRenderPerBatch` ~ 8–10; `removeClippedSubviews` on Android (test — can cause blank items); `updateCellsBatchingPeriod` ~ 50.
- Row component is `React.memo` with a custom comparator or primitive props; `renderItem` is `useCallback`; handlers passed to rows take an id rather than a fresh closure per row.
- Don't derive data inside render (`.filter().sort()` on every render) — `useMemo` keyed on inputs, or compute in the store/selector.
- No nested vertical lists inside `ScrollView`; use `ListHeaderComponent` / `SectionList`.
- Paginate (`onEndReached` with a threshold ~0.5 and an in-flight guard). Never load thousands of rows into state at once.
- Heavy row content (SVG, QR codes, gradients, shadows) is the usual UI-thread cost — render lightweight placeholders until visible or cache as image.

## Re-renders

- Find first: Profiler → components that render often with unchanged output.
- Common root causes: new object/array/function literal as prop; context value recreated each render (memoize the value or split contexts); a global store subscribed without a selector; state held too high in the tree; `useEffect` that sets state it also depends on.
- Fixes in order of preference: **move state down** → **split components** → **selector with shallow equality** → `React.memo` + stable props → `useMemo`/`useCallback`.
- Context: one context per concern; separate "state" and "dispatch" contexts; avoid putting rapidly changing values (scroll position, text input) in context.
- Text inputs: keep input state local to the input component; lift on submit/debounce, not per keystroke.
- If React Compiler is enabled (check babel config), don't hand-memoize what it already handles; keep components pure so it can optimize.

## Animation & gestures

- Reanimated shared values + `useAnimatedStyle`; gestures via Gesture Handler so both run on the UI thread. No `setState` inside `onScroll`/gesture callbacks — use shared values or `useAnimatedScrollHandler`.
- Animate `transform`/`opacity` only. Layout animations (`LayoutAnimation`, animating width/height) cause relayout every frame.
- `Animated` (core) must set `useNativeDriver: true`; it can't animate layout props.
- Avoid animating while heavy JS runs; defer work with `InteractionManager.runAfterInteractions`.
- Prefer Lottie/vector assets that are small; disable animations for `reduceMotion` users (`AccessibilityInfo.isReduceMotionEnabled`).

## Images

- `expo-image` (disk+memory cache, `contentFit`, blurhash/thumbhash placeholders). Always pass explicit `width/height`.
- Serve appropriately sized images (resize server-side/CDN). Decoded bitmap memory ≈ width × height × 4 bytes — a 4000×3000 photo is ~48MB.
- Prefetch only what's about to be shown. Use WebP/AVIF where supported.
- SVG: many `react-native-svg` nodes are expensive; flatten paths, avoid hundreds of SVGs in a list, rasterize static ones.

## Startup time

Cold start = native init + JS bundle load + first render + initial data.

- Hermes with precompiled bytecode (default in release) — confirm it's on.
- **Inline requires**: in `metro.config.js` set `transformer.getTransformOptions` → `inlineRequires: true` so modules load on first use.
- Keep the module graph at app entry small: no heavy SDK imports (crypto, wallet, charts, PDF) at top of `App.tsx`; `require` them lazily inside the feature that uses them.
- Defer non-critical init (analytics, push registration, DB migrations that aren't needed for the first screen, network warm-ups) with `InteractionManager` or `setTimeout(…, 0)` after first paint.
- Keep splash visible only until first meaningful content is ready; render skeletons rather than blocking on network.
- Avoid synchronous storage reads or large JSON.parse on startup; read the minimum (auth flag) first.
- Polyfills (Buffer, URL, TextEncoder, crypto) run before everything: keep them minimal and ordered, only what dependencies truly need.

## Bundle & app size

- Visualize the bundle; the top few packages usually dominate. Replace heavy libs with lighter ones (e.g., `date-fns` or `dayjs` instead of `moment`; avoid `lodash` full import → `lodash/xxx` or native).
- Import specific submodules, not barrels, when the lib isn't tree-shakeable.
- Android: enable R8/ProGuard shrinking and resource shrinking in release; ship AAB with per-ABI splits; avoid bundling unused `@expo/vector-icons` font families (import only the sets you use).
- Remove unused assets/fonts; compress PNGs → WebP; avoid shipping multiple font weights you don't use.
- Strip `console.*` in production with `babel-plugin-transform-remove-console` (keep `error`/`warn` if you need them).

## Memory

- Cleanup every subscription/timer/listener; cancel in-flight requests on unmount; don't `setState` after unmount.
- Bound caches (LRU), don't store large blobs in React state/context, don't keep entire history in memory.
- Images and long lists are the biggest consumers (see above). Lower `windowSize`, size images correctly.
- Navigation: screens stay mounted in a stack; heavy screens should release resources on blur (`useFocusEffect`) or `unmountOnBlur`/freeze (`react-freeze` / `freezeOnBlur`) when appropriate.
- Verify by repeating a flow ~10 times (open screen → back) and watching heap; it should plateau.

## Keeping the JS thread free

- Move CPU-heavy work (crypto, hashing, big parsing, sorting 10k+ items) off the main path: chunk with `await` yields / `requestAnimationFrame`, use a JSI/native module (e.g., `react-native-quick-crypto` for crypto instead of pure-JS libs), or precompute server-side.
- Avoid large `JSON.stringify/parse` and big array spreads in hot paths; prefer incremental updates.
- Batch network results into one state update; avoid cascading `setState` loops from sockets/streams (throttle high-frequency events).
- Debounce search/typing; throttle scroll handlers.
- `console.log` in hot paths is costly in dev and leaks data in prod.

## Hermes & New Architecture

- Hermes is the engine; keep it enabled. Its sampling profiler is your main JS tool.
- New Architecture (Fabric/TurboModules, JSI) removes the async bridge: synchronous native calls, less serialization overhead. If the project is on RN ≥0.76 it's on by default; confirm each native dependency supports it (check `expo-doctor` / library release notes) before assuming.
- When migrating, find libraries that rely on the old bridge and watch for interop-layer slowdowns.

## Android-specific tuning

- Low-end Android is the real target: test on ≤3GB RAM devices.
- Prefer `elevation` sparingly (shadows are expensive and overdraw); avoid stacked translucent layers.
- Enable R8, `enableProguardInReleaseBuilds`, and Hermes; set `largeHeap` only as a last resort.
- Edge-to-edge and keyboard handling: set `android:windowSoftInputMode` appropriately and use a keyboard-aware library rather than ad-hoc padding.
- Background kills: persist critical state (e.g., in-progress forms/transactions) and restore it; never rely on in-memory state surviving.
- ANRs: caused by main-thread blocking in native code — check native modules doing sync I/O.

## Quick-scan checklist (use when you can't profile)

- [ ] Any `ScrollView` + `.map` over unbounded data?
- [ ] List rows memoized, stable keys, no inline closures/objects?
- [ ] State too high in tree / giant context re-rendering everything?
- [ ] Derived data recomputed every render?
- [ ] `useEffect` missing cleanup or missing/incorrect deps?
- [ ] Animations on JS thread or animating layout props?
- [ ] Unsized or oversized images?
- [ ] Heavy modules imported at app entry? `inlineRequires` on?
- [ ] Heavy sync work on mount (crypto, parsing, DB)?
- [ ] Sequential network calls that could be parallel? No caching/dedupe?
- [ ] `console.log` left in hot paths?
- [ ] Release build verified on a low-end device?
