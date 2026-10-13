# Task 3.1 – Mobile Reliability: Change Review

> Branch: `rixdev` · Status: **uncommitted** · Source plan: [test-50users-plan.md](test-50users-plan.md) §3.1 · Builds on [task-1.1-changes.md](task-1.1-changes.md) and [task-1.2-changes.md](task-1.2-changes.md)
>
> Verification: mobile `tsc --noEmit` shows **no new errors** (same 6 pre-existing errors plus the 108 pre-existing `TS2786` JSX-typing errors). No raw `fetch(` remains in `apps/mobile/src` outside the client. **The mobile app has no test runner or linter**, so nothing was unit-tested. **Not yet run on a device.**
> No backend files were changed for this task.

---

## 1. Summary

| # | Plan item | Result |
|---|-----------|--------|
| 1 | Global ErrorBoundary + Sentry | 🟡 Boundary, global JS error handler and a single `reportError()` hook done. Sentry deferred (by decision). |
| 2 | Central API client | ✅ Timeout, retries with backoff, `Retry-After`, safe JWT attachment, silent SEP-10 re-auth on 401. Every raw `fetch` migrated. |
| 3 | Canonical API URL | ✅ `https://pijin-api.vercel.app`, one source (`constants/api.ts`), anchor host derived from it. |
| 4 | Onboarding state machine | ⏳ Next pass (by decision). |
| 5 | Duplicate-tap guards | ✅ Verified already present; no change. |
| 6 | Sync service batching/backoff | 🟡 Batch cap, jitter, stop on failure done. Direct settle is rejected by the backend (see §4). |
| 7 | Transient vs permanent failures | ✅ |
| 8 | ConnectionWatcher | ✅ Plus a real bug fix (redirect never fired). |
| 9 | App startup migrations | ✅ Chained; error screen with retry. |

**Decisions taken:** canonical URL `pijin-api.vercel.app`; error boundary now, Sentry later; onboarding state machine as a separate pass.

---

## 2. Files Changed

### New files

| File | Purpose |
|------|---------|
| [apps/mobile/src/components/ErrorBoundary.tsx](apps/mobile/src/components/ErrorBoundary.tsx) | Catches render errors; "Something went wrong" screen with **Try again** (remounts the tree). Shows the error message in dev builds only. |
| [apps/mobile/src/services/errorReporting.ts](apps/mobile/src/services/errorReporting.ts) | `reportError(error, context)` (the Sentry hook point) and `installGlobalErrorHandler()` for errors outside React. |

### Modified files

| File | What changed |
|------|--------------|
| [apps/mobile/src/services/api/client.ts](apps/mobile/src/services/api/client.ts) | New `apiFetch` (raw `Response`), `fetchWithTimeout` (any host), `setReauthHandler`; `apiRequest` rebuilt on `apiFetch`; `ApiError` gains `kind` (`http` / `timeout` / `network`). |
| [apps/mobile/src/constants/api.ts](apps/mobile/src/constants/api.ts) | `DEFAULT_API_BASE_URL`, release builds refuse non-https, `getAnchorDomain()`. |
| [apps/mobile/src/context/AuthContext.tsx](apps/mobile/src/context/AuthContext.tsx) | Registers the re-auth handler: signs a fresh SEP-10 challenge with the wallet key already on the device. |
| [apps/mobile/App.tsx](apps/mobile/App.tsx) | `ErrorBoundary` wrapper, global handler, `ensureMigration → runMigrations → syncService.start` in order, splash until DB ready, "Pijin couldn't start" + **Try again**. |
| [apps/mobile/src/services/syncService.ts](apps/mobile/src/services/syncService.ts) | `SyncPostError` + `classifySettleStatus`, max 5 posts per flush, 0–3s jitter on automatic flushes, stop on first transient/rejected failure, permanent failures marked `FAILED`. |
| [apps/mobile/src/components/ui/ConnectionWatcher.tsx](apps/mobile/src/components/ui/ConnectionWatcher.tsx) | Subscription effect depends only on `currentMode`; banner state and callbacks via refs; resets cleanly on mode change. |
| [apps/mobile/src/screens/LoadOfflineFundsScreen.tsx](apps/mobile/src/screens/LoadOfflineFundsScreen.tsx), [LoadOnlineFundsScreen.tsx](apps/mobile/src/screens/LoadOnlineFundsScreen.tsx), [SendMoneyConfirmScreen.tsx](apps/mobile/src/screens/SendMoneyConfirmScreen.tsx) | API URL from `getApiBaseUrl()`; engine assemble via `apiFetch` (25s, signature header kept, no retry); Soroban RPC send/poll via `fetchWithTimeout`; recipient lookup via `apiFetch`. |
| [apps/mobile/src/screens/SendMoneyScreen.tsx](apps/mobile/src/screens/SendMoneyScreen.tsx) | Lookups via `apiFetch` (search-as-you-type with `retries: 0`). |
| [apps/mobile/src/screens/OnboardingScreen.tsx](apps/mobile/src/screens/OnboardingScreen.tsx) | OTP send/verify and Friendbot via `apiFetch` (Friendbot keeps its own retry loop: `retries: 0`, 20s). |
| [apps/mobile/src/services/wallet/offlineKeySync.ts](apps/mobile/src/services/wallet/offlineKeySync.ts), [recipientRegistrySync.ts](apps/mobile/src/services/wallet/recipientRegistrySync.ts) | Backend calls via `apiFetch` (25s, SEP-10 header kept); RPC via `fetchWithTimeout`. |
| [apps/mobile/src/services/stellar/anchorService.ts](apps/mobile/src/services/stellar/anchorService.ts), [trustlineService.ts](apps/mobile/src/services/stellar/trustlineService.ts), [services/soroban/deposit.ts](apps/mobile/src/services/soroban/deposit.ts) | All `fetch` → `fetchWithTimeout`; `ANCHOR_DOMAIN` from `getAnchorDomain()`. |
| [apps/mobile/src/db/services/transactionDb.ts](apps/mobile/src/db/services/transactionDb.ts) | Name lookup via `apiFetch` (`retries: 0`, avoids multiplying the per-row loop); duplicate URL default removed. |
| [apps/mobile/.env.example](apps/mobile/.env.example) | `EXPO_PUBLIC_API_BASE_URL="https://pijin-api.vercel.app"`. |
| [test-50users-plan.md](test-50users-plan.md) | §3.1 and related items updated; open question 1 answered. |

---

## 3. Behaviour Details

### API client
| Option | Default | Notes |
|---|---|---|
| `timeoutMs` | 15 000 | Per attempt. Engine assemble and wallet sync use 25 000; Friendbot 20 000. |
| `retries` | 2 for GET/HEAD, 0 otherwise | Retried on network error, timeout, 408, 429, 5xx. **POSTs are never retried automatically** (money actions stay single-shot). |
| backoff | `500ms × 2^attempt` + 0–250ms jitter | `Retry-After` wins when present (capped at 10s). |
| `auth` | true | Stored JWT is attached **only if the caller set no `Authorization`**. Fixes a latent bug: the old client overwrote caller headers, which would have broken the signature-authenticated engine routes. |
| 401 | – | If a JWT was sent: one shared re-auth (SEP-10 with the device's wallet key), then one retry. If re-auth fails, the 401 is returned to the caller. |

Errors without a response throw `ApiError` with `status: 0` and `kind: 'timeout'` or `'network'`, with user-readable messages. `apiRequest` also gives friendly defaults for 429 and 5xx when the body has no `error`.

### Sync service
| Backend answer | Item outcome | Flush |
|---|---|---|
| 2xx `SETTLED` / `409` | synced | continue |
| 2xx `status: FAILED` | permanent `FAILED` | continue |
| 400 / 413 / 422 | permanent `FAILED` | continue |
| 401 / 403 | stays pending (error recorded) | **stop** |
| network / timeout / 408 / 429 / 5xx | stays pending (error recorded) | **stop** |

- Items whose nonce already appears in `/api/transactions` are marked settled without a request and don't count toward the 5-post cap.
- Jitter applies only to the automatic offline→online flush, not to Dashboard's manual flush.

### Startup
`ensureMigration()` → `runMigrations()` → `syncService.start()`. Splash stays until this finishes; on error, "Pijin couldn't start" with **Try again** reruns both (both are idempotent).

### ConnectionWatcher bug (fixed)
Old: going offline on an online screen set `showBanner = true`; because `showBanner` was an effect dependency, the effect re-ran and its cleanup cleared the 3-second redirect timer and the countdown interval. The new subscription saw `showBanner === true` and did nothing, so the banner stayed at "3" and the redirect never happened. New: the effect depends only on `currentMode`; visibility is tracked in a ref.

---

## 4. Findings That Need Follow-up

1. **Direct settlement is rejected in production.** `/api/engine/settle` requires a QStash signature, so `syncService.postToBackend` gets `401`. Offline payments still settle via SMS → TextBee webhook → QStash, and the sync loop picks up the result through `/api/transactions`. If the app's online fallback is wanted, the backend must accept device-signed submissions (backend change, needs approval).
2. **`senderPhone` stays `null`** on purpose: if the client supplied it, anyone could make the backend text arbitrary numbers.
3. **Sentry**: install `@sentry/react-native` + config plugin, set the DSN, call `Sentry.captureException` inside `reportError()`, then build a new APK.
4. **Onboarding state machine** (resumable steps with per-step status) is the next pass.
5. **Per-item retry backoff** (`nextRetryAt` column) is still open; for now a failed flush simply stops until the next trigger.
6. **No mobile test runner.** Adding Jest (`jest-expo`) would allow unit tests for `classifySettleStatus`, the client retry logic and the ConnectionWatcher.

---

## 5. Test Checklist (on a preview APK)

- [ ] Normal sign-in, send, deposit and withdraw still work (engine routes accept the signature header).
- [ ] Airplane mode during a lookup → error appears within ~15s (no endless spinner).
- [ ] Throttled network: SEP-24 / anchor calls time out with "The server took too long to respond".
- [ ] Expire/clear the stored JWT, then open a SEP-10-protected flow → succeeds without being sent to sign-in (silent re-auth).
- [ ] On an online screen, disable Wi-Fi/data → banner counts 3-2-1-0 and redirects to Dashboard.
- [ ] Re-enable network before 3s → banner hides, no redirect.
- [ ] Queue 8 offline payments, reconnect → at most 5 posts per flush; with the backend returning 401 they stay pending; after SMS settlement they turn `SETTLED`.
- [ ] Force a render error (dev) → "Something went wrong" screen; **Try again** recovers.
- [ ] Corrupt/lock the SQLite DB (dev) → "Pijin couldn't start" screen; **Try again** retries.
- [ ] Build with `EXPO_PUBLIC_API_BASE_URL` unset → app still talks to `pijin-api.vercel.app`.

---

## Appendix: Full Diff

<details><summary>Modified files (3.1 only; OnboardingScreen/SignIn/accounts also carry 1.1/1.2 changes)</summary>

```diff
diff --git a/apps/mobile/.env.example b/apps/mobile/.env.example
index b59e1db..5907767 100644
--- a/apps/mobile/.env.example
+++ b/apps/mobile/.env.example
@@ -5,7 +5,7 @@
 # API Endpoints
 # ==============================================================================
 # Backend API Base URL 
-EXPO_PUBLIC_API_BASE_URL="https://pijin.live"
+EXPO_PUBLIC_API_BASE_URL="https://pijin-api.vercel.app"
 
 # SEP-24 Anchor backend domain
 EXPO_PUBLIC_ANCHOR_DOMAIN="pijin-api.vercel.app"
diff --git a/apps/mobile/App.tsx b/apps/mobile/App.tsx
index d4adff4..f634354 100644
--- a/apps/mobile/App.tsx
+++ b/apps/mobile/App.tsx
@@ -14,6 +14,13 @@ import { OnboardingScreen, DashboardScreen, SignInScreen, TransactionReceiptScre
 import { Sep24WebviewScreen } from './src/screens/Sep24WebviewScreen';
 import { isOnboardingComplete } from './src/services/storage/onboardingStorage';
 import { ensureMigration } from './src/services/storage/migration';
+import { ErrorBoundary } from './src/components/ErrorBoundary';
+import { AppButton } from './src/components/ui/AppButton';
+import { installGlobalErrorHandler, reportError } from './src/services/errorReporting';
+
+installGlobalErrorHandler();
+
+type DbStatus = 'pending' | 'ready' | 'error';
 
 type RootStackParamList = {
   Onboarding: { initialStep?: 1 | 2 | 3 | 4 | 5 | 6 } | undefined;
@@ -84,10 +91,14 @@ function AppContent({
   fontsLoaded,
   fontError,
   fontLoadTimedOut,
+  dbStatus,
+  onRetryDb,
 }: {
   fontsLoaded: boolean;
   fontError: any;
   fontLoadTimedOut: boolean;
+  dbStatus: DbStatus;
+  onRetryDb: () => void;
 }) {
   const { isAppReady } = useAuth();
   const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList | null>(null);
@@ -108,7 +119,17 @@ function AppContent({
     }
   }, [isAppReady]);
 
-  if (!isAppReady || (!fontsLoaded && !fontError && !fontLoadTimedOut) || !initialRoute) {
+  if (dbStatus === 'error') {
+    return (
+      <View style={styles.splashContainer} accessibilityRole="alert">
+        <Text style={styles.errorTitle}>Pijin couldn't start</Text>
+        <Text style={styles.splashText}>Local storage failed to open. Your wallet is safe — please try again.</Text>
+        <AppButton title="Try again" onPress={onRetryDb} style={styles.retryButton} />
+      </View>
+    );
+  }
+
+  if (dbStatus !== 'ready' || !isAppReady || (!fontsLoaded && !fontError && !fontLoadTimedOut) || !initialRoute) {
     return (
       <View style={styles.splashContainer}>
         <ActivityIndicator size="large" color="#111111" />
@@ -129,32 +150,34 @@ export default function App() {
   const [fontsLoaded, fontError] = useFonts(Ionicons.font);
   const [fontLoadTimedOut, setFontLoadTimedOut] = useState(false);
   const isMountedRef = useRef(true);
+  const [dbStatus, setDbStatus] = useState<DbStatus>('pending');
+  const [dbAttempt, setDbAttempt] = useState(0);
 
-  // Initialize the SQLite database and start the RxJS sync service.
-  // runMigrations() is idempotent — safe to run on every app launch.
+  // Initialize storage, then the SQLite database, then the RxJS sync service —
+  // in that order. Both migrations are idempotent, so retrying is safe.
   useEffect(() => {
     isMountedRef.current = true;
-    
-    // Ensure all storage migrations run first
-    ensureMigration().catch(err => {
-      console.error('[App] Storage migration failed:', err);
-    });
-
-    runMigrations()
-      .then(() => {
-        if (isMountedRef.current) {
-          syncService.start();
-        }
-      })
-      .catch(err => {
-        console.error('[App] DB initialization failed:', err);
-      });
+    setDbStatus('pending');
+
+    const init = async () => {
+      try {
+        await ensureMigration();
+        await runMigrations();
+        if (!isMountedRef.current) return;
+        setDbStatus('ready');
+        syncService.start();
+      } catch (err) {
+        reportError(err, { source: 'App.init', attempt: dbAttempt });
+        if (isMountedRef.current) setDbStatus('error');
+      }
+    };
+    init();
 
     return () => {
       isMountedRef.current = false;
       syncService.stop();
     };
-  }, []);
+  }, [dbAttempt]);
 
   useEffect(() => {
     if (fontError) {
@@ -177,13 +200,17 @@ export default function App() {
 
   return (
     <SafeAreaProvider>
-      <AuthProvider>
-        <AppContent
-          fontsLoaded={fontsLoaded}
-          fontError={fontError}
-          fontLoadTimedOut={fontLoadTimedOut}
-        />
-      </AuthProvider>
+      <ErrorBoundary>
+        <AuthProvider>
+          <AppContent
+            fontsLoaded={fontsLoaded}
+            fontError={fontError}
+            fontLoadTimedOut={fontLoadTimedOut}
+            dbStatus={dbStatus}
+            onRetryDb={() => setDbAttempt((n) => n + 1)}
+          />
+        </AuthProvider>
+      </ErrorBoundary>
     </SafeAreaProvider>
   );
 }
@@ -199,5 +226,16 @@ const styles = StyleSheet.create({
   splashText: {
     color: '#4B5563',
     fontSize: 14,
+    textAlign: 'center',
+    paddingHorizontal: 32,
+  },
+  errorTitle: {
+    color: '#111111',
+    fontSize: 20,
+    fontWeight: '700',
+  },
+  retryButton: {
+    marginTop: 8,
+    minWidth: 160,
   },
 });
diff --git a/apps/mobile/src/components/ui/ConnectionWatcher.tsx b/apps/mobile/src/components/ui/ConnectionWatcher.tsx
index 8a09988..2c64367 100644
--- a/apps/mobile/src/components/ui/ConnectionWatcher.tsx
+++ b/apps/mobile/src/components/ui/ConnectionWatcher.tsx
@@ -14,73 +14,94 @@ export function ConnectionWatcher({ navigation, currentMode, onOfflineRedirect }
   const [countdown, setCountdown] = useState(3);
   const bannerAnim = useRef(new Animated.Value(-120)).current;
   
-  const timerRef = useRef<any>(null);
-  const intervalRef = useRef<any>(null);
+  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
+  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
+
+  // Read the latest values from refs so the subscription below does not need
+  // them as dependencies. Previously `showBanner` was a dependency: showing the
+  // banner re-ran the effect, whose cleanup cancelled the redirect timer and
+  // the countdown it had just started.
+  const bannerVisibleRef = useRef(false);
+  const navigationRef = useRef(navigation);
+  const onOfflineRedirectRef = useRef(onOfflineRedirect);
+  navigationRef.current = navigation;
+  onOfflineRedirectRef.current = onOfflineRedirect;
 
   useEffect(() => {
+    const clearTimers = () => {
+      if (timerRef.current) clearTimeout(timerRef.current);
+      if (intervalRef.current) clearInterval(intervalRef.current);
+      timerRef.current = null;
+      intervalRef.current = null;
+    };
+
     const subscription = connectionService.state$.subscribe((state) => {
       // If physically disconnected and currently on an Online page/flow
       if (!state.isConnected && currentMode === 'online') {
-        if (!showBanner) {
-          setShowBanner(true);
-          setCountdown(3);
-
-          // Animate banner sliding in from top
-          Animated.spring(bannerAnim, {
-            toValue: 10,
-            useNativeDriver: true,
-            tension: 40,
-            friction: 8,
-          }).start();
+        if (bannerVisibleRef.current) return;
+        bannerVisibleRef.current = true;
+        setShowBanner(true);
+        setCountdown(3);
 
-          // 3-second redirect timer
-          timerRef.current = setTimeout(() => {
-            Animated.timing(bannerAnim, {
-              toValue: -120,
-              duration: 250,
-              useNativeDriver: true,
-            }).start(() => {
-              setShowBanner(false);
-              if (onOfflineRedirect) {
-                onOfflineRedirect();
-              } else if (navigation) {
-                navigation.navigate('Dashboard');
-              }
-            });
-          }, 3000);
+        // Animate banner sliding in from top
+        Animated.spring(bannerAnim, {
+          toValue: 10,
+          useNativeDriver: true,
+          tension: 40,
+          friction: 8,
+        }).start();
 
-          // Countdown tick
-          let currentCount = 3;
-          intervalRef.current = setInterval(() => {
-            currentCount -= 1;
-            if (currentCount >= 0) {
-              setCountdown(currentCount);
-            }
-          }, 1000);
-        }
-      } else {
-        // If we regained connection or if we are in Offline mode, hide the banner
-        if (showBanner) {
-          if (timerRef.current) clearTimeout(timerRef.current);
+        // 3-second redirect timer
+        timerRef.current = setTimeout(() => {
           if (intervalRef.current) clearInterval(intervalRef.current);
-
           Animated.timing(bannerAnim, {
             toValue: -120,
             duration: 250,
             useNativeDriver: true,
           }).start(() => {
+            bannerVisibleRef.current = false;
             setShowBanner(false);
+            if (onOfflineRedirectRef.current) {
+              onOfflineRedirectRef.current();
+            } else if (navigationRef.current) {
+              navigationRef.current.navigate('Dashboard');
+            }
           });
-        }
+        }, 3000);
+
+        // Countdown tick
+        let currentCount = 3;
+        intervalRef.current = setInterval(() => {
+          currentCount -= 1;
+          if (currentCount >= 0) {
+            setCountdown(currentCount);
+          }
+        }, 1000);
+      } else if (bannerVisibleRef.current) {
+        // Regained connection or switched to Offline mode: cancel the redirect and hide the banner
+        clearTimers();
+        Animated.timing(bannerAnim, {
+          toValue: -120,
+          duration: 250,
+          useNativeDriver: true,
+        }).start(() => {
+          bannerVisibleRef.current = false;
+          setShowBanner(false);
+        });
       }
     });
 
     return () => {
       subscription.unsubscribe();
-      if (timerRef.current) clearTimeout(timerRef.current);
-      if (intervalRef.current) clearInterval(intervalRef.current);
+      clearTimers();
+      // Reset so a re-subscription (e.g. mode change) can start a fresh banner cycle.
+      if (bannerVisibleRef.current) {
+        bannerVisibleRef.current = false;
+        bannerAnim.setValue(-120);
+        setShowBanner(false);
+      }
     };
-  }, [currentMode, showBanner]);
+  }, [currentMode, bannerAnim]);
 
   if (!showBanner) return null;
 
diff --git a/apps/mobile/src/constants/api.ts b/apps/mobile/src/constants/api.ts
index a2d18a9..fad34b0 100644
--- a/apps/mobile/src/constants/api.ts
+++ b/apps/mobile/src/constants/api.ts
@@ -1,11 +1,45 @@
-const apiBaseUrl =
-  process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '') ||
-  'https://pijin-api.vercel.app';
+/**
+ * Single source of truth for backend hosts.
+ *
+ * Canonical production API: https://pijin-api.vercel.app (also the SEP-10 anchor
+ * home domain). Builds set EXPO_PUBLIC_API_BASE_URL via eas.json; the default
+ * below is the same value so a missing variable can't point testers elsewhere.
+ */
+
+export const DEFAULT_API_BASE_URL = 'https://pijin-api.vercel.app';
+
+function cleanUrl(raw: string | undefined): string | null {
+  const value = raw?.trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
+  return value ? value : null;
+}
+
+function resolveApiBaseUrl(): string {
+  const configured = cleanUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
+  if (!configured) {
+    if (__DEV__) console.warn(`[api] EXPO_PUBLIC_API_BASE_URL not set; using ${DEFAULT_API_BASE_URL}`);
+    return DEFAULT_API_BASE_URL;
+  }
+  // Release builds must talk to an https host; anything else is a misconfigured build.
+  if (!__DEV__ && !configured.startsWith('https://')) {
+    console.error(`[api] Refusing non-https API base URL in release build: ${configured}`);
+    return DEFAULT_API_BASE_URL;
+  }
+  return configured;
+}
+
+const apiBaseUrl = resolveApiBaseUrl();
 
 export function getApiBaseUrl(): string {
   return apiBaseUrl;
 }
 
+/** SEP-10/SEP-24 home domain: explicit override, otherwise the API host. */
+export function getAnchorDomain(): string {
+  const override = cleanUrl(process.env.EXPO_PUBLIC_ANCHOR_DOMAIN);
+  if (override) return override.replace(/^https?:\/\//, '');
+  return apiBaseUrl.replace(/^https?:\/\//, '');
+}
+
 export const SMS_SIMULATE_SECRET =
   process.env.EXPO_PUBLIC_SMS_SIMULATE_SECRET ?? 'dev-simulate';
 
diff --git a/apps/mobile/src/context/AuthContext.tsx b/apps/mobile/src/context/AuthContext.tsx
index a51b642..cd69fef 100644
--- a/apps/mobile/src/context/AuthContext.tsx
+++ b/apps/mobile/src/context/AuthContext.tsx
@@ -1,6 +1,8 @@
 import React, { createContext, useContext, useState, useEffect } from 'react';
 import { loadStoredAccount, saveStoredAccount, clearStoredAccount, type StoredAccount } from '../services/storage/accountStorage';
-import { getStoredJwt, setStoredJwt } from '../services/api/client';
+import { getStoredJwt, setReauthHandler, setStoredJwt } from '../services/api/client';
+import { getMainWalletSecret } from '../services/storage/onboardingStorage';
+import { getSep10Token, Keypair } from '../services/stellar/anchorService';
 
 export type UserMode = 'customer' | 'merchant';
 
@@ -57,6 +59,19 @@ export function AuthProvider({ children }: { children: React.ReactNode }) {
     };
   }, []);
 
+  // On a 401 the API client asks for a fresh SEP-10 token, signed with the
+  // wallet key already on this device, and retries once — no logout needed.
+  useEffect(() => {
+    setReauthHandler(async () => {
+      const secret = await getMainWalletSecret();
+      if (!secret) return null;
+      const token = await getSep10Token(Keypair.fromSecret(secret));
+      setJwt(token);
+      return token;
+    });
+    return () => setReauthHandler(null);
+  }, []);
+
   const login = async (publicKey: string, shortId: string, token?: string) => {
     const account: StoredAccount = {
       shortId,
diff --git a/apps/mobile/src/db/services/transactionDb.ts b/apps/mobile/src/db/services/transactionDb.ts
index 3035258..e3c4b71 100644
--- a/apps/mobile/src/db/services/transactionDb.ts
+++ b/apps/mobile/src/db/services/transactionDb.ts
@@ -17,6 +17,7 @@ import { db } from '../client';
 import { transactions, type TransactionRow, type NewTransactionRow } from '../schema';
 import { desc, eq, like, ne } from 'drizzle-orm';
 import type { TransactionType } from '../../types/transaction';
+import { apiFetch } from '../../services/api/client';
 
 // ---------------------------------------------------------------------------
 // Types
@@ -344,10 +345,6 @@ export async function correctLegacyTags(): Promise<void> {
  */
 export async function resolveOfflineTransactionNames(): Promise<void> {
   try {
-    const API_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://pijin-api.vercel.app')
-      .trim()
-      .replace(/^['"]|['"]$/g, '');
-    
     // Find all OFFLINE transactions
     const unresolvedTxs = await db
       .select()
@@ -361,7 +358,7 @@ export async function resolveOfflineTransactionNames(): Promise<void> {
       if (match && match[1]) {
         const shortId = match[1];
         try {
-          const res = await fetch(`${API_URL}/api/users/lookup?shortId=${encodeURIComponent(shortId)}`);
+          const res = await apiFetch(`/api/users/lookup?shortId=${encodeURIComponent(shortId)}`, { auth: false, retries: 0 });
           if (res.ok) {
             const data = await res.json();
             if (data.found && data.displayName) {
diff --git a/apps/mobile/src/screens/LoadOfflineFundsScreen.tsx b/apps/mobile/src/screens/LoadOfflineFundsScreen.tsx
index fe0453b..9b269be 100644
--- a/apps/mobile/src/screens/LoadOfflineFundsScreen.tsx
+++ b/apps/mobile/src/screens/LoadOfflineFundsScreen.tsx
@@ -21,6 +21,8 @@ import Svg, { Path } from 'react-native-svg';
 import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';
 import { useAuth } from '../context/AuthContext';
 import { ErrorModal } from '../components/ui/ErrorModal';
+import { getApiBaseUrl } from '../constants/api';
+import { apiFetch, fetchWithTimeout } from '../services/api/client';
 
 const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
 const BUTTON_WIDTH = 52;
@@ -145,7 +147,7 @@ async function executeDeposit(input: { customerPublicKey: string; amount: number
   // assembled (but unsigned) XDR envelope.
   //
   markStage('assemble-via-backend');
-  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/^['"]|['"]$/g, '');
+  const apiBase = getApiBaseUrl();
   const tokenAddress = process.env.EXPO_PUBLIC_TOKEN_ID?.trim().replace(/^['"]|['"]$/g, '');
   const rpcUrl = process.env.EXPO_PUBLIC_SOROBAN_RPC_URL?.trim().replace(/^['"]|['"]$/g, '');
   const networkPassphrase = process.env.EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE?.trim().replace(/^['"]|['"]$/g, '');
@@ -157,7 +159,9 @@ async function executeDeposit(input: { customerPublicKey: string; amount: number
 
   let assembleResponse: Response;
   try {
-    assembleResponse = await fetch(`${apiBase}/api/engine/deposit`, {
+    assembleResponse = await apiFetch(`${apiBase}/api/engine/deposit`, {
+      auth: false,
+      timeoutMs: 25_000,
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
@@ -223,7 +227,7 @@ async function executeDeposit(input: { customerPublicKey: string; amount: number
   markStage('submit');
   let txHash: string | undefined;
   try {
-    const sendResp = await fetch(rpcUrl, {
+    const sendResp = await fetchWithTimeout(rpcUrl, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
@@ -254,7 +258,7 @@ async function executeDeposit(input: { customerPublicKey: string; amount: number
     for (let attempt = 0; attempt < maxAttempts; attempt++) {
       await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
       try {
-        const pollResp = await fetch(rpcUrl, {
+        const pollResp = await fetchWithTimeout(rpcUrl, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
diff --git a/apps/mobile/src/screens/LoadOnlineFundsScreen.tsx b/apps/mobile/src/screens/LoadOnlineFundsScreen.tsx
index a1b5383..1720536 100644
--- a/apps/mobile/src/screens/LoadOnlineFundsScreen.tsx
+++ b/apps/mobile/src/screens/LoadOnlineFundsScreen.tsx
@@ -21,6 +21,8 @@ import Svg, { Path } from 'react-native-svg';
 import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';
 import { useAuth } from '../context/AuthContext';
 import { ErrorModal } from '../components/ui/ErrorModal';
+import { getApiBaseUrl } from '../constants/api';
+import { apiFetch, fetchWithTimeout } from '../services/api/client';
 
 const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
 const BUTTON_WIDTH = 52;
@@ -127,7 +129,7 @@ async function executeWithdraw(input: { customerPublicKey: string; amount: numbe
 
   // ── 4. POST to backend to simulate & assemble the transaction XDR ─────────
   markStage('assemble-via-backend');
-  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/^['"]|['"]$/g, '');
+  const apiBase = getApiBaseUrl();
   const tokenAddress = process.env.EXPO_PUBLIC_TOKEN_ID?.trim().replace(/^['"]|['"]$/g, '');
   const rpcUrl = process.env.EXPO_PUBLIC_SOROBAN_RPC_URL?.trim().replace(/^['"]|['"]$/g, '');
   const networkPassphrase = process.env.EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE?.trim().replace(/^['"]|['"]$/g, '');
@@ -139,7 +141,9 @@ async function executeWithdraw(input: { customerPublicKey: string; amount: numbe
 
   let assembleResponse: Response;
   try {
-    assembleResponse = await fetch(`${apiBase}/api/engine/withdraw`, {
+    assembleResponse = await apiFetch(`${apiBase}/api/engine/withdraw`, {
+      auth: false,
+      timeoutMs: 25_000,
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
@@ -204,7 +208,7 @@ async function executeWithdraw(input: { customerPublicKey: string; amount: numbe
   markStage('submit');
   let txHash: string | undefined;
   try {
-    const sendResp = await fetch(rpcUrl, {
+    const sendResp = await fetchWithTimeout(rpcUrl, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
@@ -235,7 +239,7 @@ async function executeWithdraw(input: { customerPublicKey: string; amount: numbe
     for (let attempt = 0; attempt < maxAttempts; attempt++) {
       await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
       try {
-        const pollResp = await fetch(rpcUrl, {
+        const pollResp = await fetchWithTimeout(rpcUrl, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
diff --git a/apps/mobile/src/screens/SendMoneyConfirmScreen.tsx b/apps/mobile/src/screens/SendMoneyConfirmScreen.tsx
index 78a28bd..42192ed 100644
--- a/apps/mobile/src/screens/SendMoneyConfirmScreen.tsx
+++ b/apps/mobile/src/screens/SendMoneyConfirmScreen.tsx
@@ -27,6 +27,7 @@ import { OfflinePaymentPayload } from '../types/payment';
 import { ConnectionWatcher } from '../components/ui/ConnectionWatcher';
 import { confirmOnlineTransfer } from '../services/api/transactions';
 import { getApiBaseUrl } from '../constants/api';
+import { apiFetch, fetchWithTimeout } from '../services/api/client';
 
 const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
 const BUTTON_WIDTH = 56;
@@ -49,7 +50,7 @@ async function resolveRecipientPublicKey(shortId: string): Promise<string> {
     throw new Error('Recipient Short ID is missing.');
   }
 
-  const response = await fetch(
+  const response = await apiFetch(
     `${API_URL}/api/users/lookup?shortId=${encodeURIComponent(normalizedShortId)}`,
   );
   const data = await response.json().catch(() => ({}));
@@ -96,7 +97,7 @@ async function executeTransfer(input: { senderPublicKey: string; recipientPublic
   }
 
   const amountStroops = amountToStroops(input.amount).toString();
-  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/^['"]|['"]$/g, '');
+  const apiBase = getApiBaseUrl();
   const tokenAddress = process.env.EXPO_PUBLIC_TOKEN_ID?.trim().replace(/^['"]|['"]$/g, '');
   const rpcUrl = process.env.EXPO_PUBLIC_SOROBAN_RPC_URL?.trim().replace(/^['"]|['"]$/g, '');
   const networkPassphrase = process.env.EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE?.trim().replace(/^['"]|['"]$/g, '');
@@ -105,7 +106,9 @@ async function executeTransfer(input: { senderPublicKey: string; recipientPublic
   const sigBuffer = mainWalletKeypair.sign(Buffer.from(canonicalMessage));
   const sigBase64 = Buffer.from(sigBuffer).toString('base64');
 
-  const assembleResponse = await fetch(`${apiBase}/api/engine/transfer`, {
+  const assembleResponse = await apiFetch(`${apiBase}/api/engine/transfer`, {
+      auth: false,
+      timeoutMs: 25_000,
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
@@ -147,7 +150,7 @@ async function executeTransfer(input: { senderPublicKey: string; recipientPublic
   }
   const signedXdrBase64 = Buffer.from(bytes).toString('base64');
 
-  const sendResp = await fetch(rpcUrl, {
+  const sendResp = await fetchWithTimeout(rpcUrl, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
@@ -176,7 +179,7 @@ async function executeTransfer(input: { senderPublicKey: string; recipientPublic
     let confirmed = false;
     for (let attempt = 0; attempt < 15; attempt++) {
       await new Promise((resolve) => setTimeout(resolve, 2000));
-      const pollResp = await fetch(rpcUrl, {
+      const pollResp = await fetchWithTimeout(rpcUrl, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
diff --git a/apps/mobile/src/screens/SendMoneyScreen.tsx b/apps/mobile/src/screens/SendMoneyScreen.tsx
index 2d861a9..a106065 100644
--- a/apps/mobile/src/screens/SendMoneyScreen.tsx
+++ b/apps/mobile/src/screens/SendMoneyScreen.tsx
@@ -27,6 +27,7 @@ import { db } from '../db/client';
 import { paymentQueue as paymentQueueTable } from '../db/schema';
 import { eq, and } from 'drizzle-orm';
 import { getApiBaseUrl } from '../constants/api';
+import { apiFetch } from '../services/api/client';
 
 const { width: SCREEN_WIDTH } = Dimensions.get('window');
 const CACHED_BALANCE_KEY = 'pijn.cached_balance';
@@ -195,7 +196,7 @@ export function SendMoneyScreen({ route, navigation }: any) {
         return;
       }
 
-      const res = await fetch(`${API_URL}/api/users/lookup?${paramKey}=${encodeURIComponent(q)}`);
+      const res = await apiFetch(`${API_URL}/api/users/lookup?${paramKey}=${encodeURIComponent(q)}`, { retries: 0 });
       if (res.status === 404) {
         setSearchError('No account found with that Short ID or phone number.');
         return;
@@ -280,7 +281,7 @@ export function SendMoneyScreen({ route, navigation }: any) {
         } else {
           // Online lookup
           const paramKey = isPhone ? 'phone' : 'shortId';
-          const res = await fetch(`${API_URL}/api/users/lookup?${paramKey}=${encodeURIComponent(q)}`);
+          const res = await apiFetch(`${API_URL}/api/users/lookup?${paramKey}=${encodeURIComponent(q)}`);
           if (res.status === 404 || !res.ok) {
             setRecipientShortIdError('No account found with that Short ID or phone number.');
             setIsResolving(false);
diff --git a/apps/mobile/src/services/api/client.ts b/apps/mobile/src/services/api/client.ts
index 8e56dd9..375109f 100644
--- a/apps/mobile/src/services/api/client.ts
+++ b/apps/mobile/src/services/api/client.ts
@@ -3,6 +3,9 @@ import { getApiBaseUrl } from '../../constants/api';
 
 const JWT_KEY = 'pijin.auth.jwt';
 
+export const DEFAULT_TIMEOUT_MS = 15_000;
+const MAX_RETRY_AFTER_MS = 10_000;
+
 export async function getStoredJwt(): Promise<string | null> {
   try {
     return await SecureStore.getItemAsync(JWT_KEY);
@@ -21,57 +24,200 @@ export async function setStoredJwt(token: string | null): Promise<void> {
   } catch {}
 }
 
+/**
+ * `status` is the HTTP status, or 0 when no response arrived
+ * (`kind` = 'timeout' | 'network').
+ */
 export class ApiError extends Error {
   constructor(
     message: string,
     public readonly status: number,
-    public readonly body?: unknown
+    public readonly body?: unknown,
+    public readonly kind: 'http' | 'timeout' | 'network' = 'http'
   ) {
     super(message);
     this.name = 'ApiError';
   }
 }
 
-export async function apiRequest<T>(
-  path: string,
-  init?: RequestInit
-): Promise<T> {
-  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
-  const jwt = await getStoredJwt();
+export type ApiRequestInit = RequestInit & {
+  /** Per-attempt timeout. Default 15s. */
+  timeoutMs?: number;
+  /** Extra attempts on network errors, timeouts, 408, 429 and 5xx. Default 2 for GET/HEAD, 0 otherwise. */
+  retries?: number;
+  /** Attach the stored SEP-10 JWT when the caller set no Authorization header. Default true. */
+  auth?: boolean;
+};
 
-  const headers: HeadersInit = {
-    'Content-Type': 'application/json',
-    ...(init?.headers ?? {}),
-  };
+// ---------------------------------------------------------------------------
+// Re-authentication
+// ---------------------------------------------------------------------------
+
+type ReauthHandler = () => Promise<string | null>;
+let reauthHandler: ReauthHandler | null = null;
+let reauthInFlight: Promise<string | null> | null = null;
+
+/**
+ * Registers how to obtain a fresh SEP-10 JWT after a 401 (see AuthContext).
+ * Concurrent 401s share one re-auth attempt.
+ */
+export function setReauthHandler(handler: ReauthHandler | null): void {
+  reauthHandler = handler;
+}
 
-  if (jwt) {
-    (headers as Record<string, string>)['Authorization'] = `Bearer ${jwt}`;
+async function refreshJwt(): Promise<string | null> {
+  if (!reauthHandler) return null;
+  if (!reauthInFlight) {
+    reauthInFlight = reauthHandler()
+      .then(async (token) => {
+        if (token) await setStoredJwt(token);
+        return token;
+      })
+      .catch((err) => {
+        console.warn('[api] Re-authentication failed:', err);
+        return null;
+      })
+      .finally(() => {
+        reauthInFlight = null;
+      });
   }
+  return reauthInFlight;
+}
 
-  const response = await fetch(url, {
-    ...init,
-    headers,
-  });
+// ---------------------------------------------------------------------------
+// Transport
+// ---------------------------------------------------------------------------
 
-  let body: unknown = null;
-  const text = await response.text();
-  if (text) {
+const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
+
+function isRetryableStatus(status: number): boolean {
+  return status === 408 || status === 429 || status >= 500;
+}
+
+function backoffMs(attempt: number, retryAfterHeader: string | null): number {
+  const retryAfter = Number(retryAfterHeader);
+  if (Number.isFinite(retryAfter) && retryAfter > 0) {
+    return Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
+  }
+  return 500 * 2 ** attempt + Math.random() * 250;
+}
+
+/**
+ * fetch with a timeout, for any URL (Soroban RPC, Horizon, anchor).
+ * Throws ApiError(kind 'timeout' | 'network') when no response arrives.
+ */
+export async function fetchWithTimeout(
+  url: string,
+  init: RequestInit = {},
+  timeoutMs: number = DEFAULT_TIMEOUT_MS
+): Promise<Response> {
+  const controller = new AbortController();
+  const timer = setTimeout(() => controller.abort(), timeoutMs);
+  const callerSignal = init.signal;
+  const onCallerAbort = () => controller.abort();
+  callerSignal?.addEventListener?.('abort', onCallerAbort);
+
+  try {
+    return await fetch(url, { ...init, signal: controller.signal });
+  } catch (err) {
+    if (callerSignal?.aborted) throw err;
+    if (controller.signal.aborted) {
+      throw new ApiError('The server took too long to respond. Please try again.', 0, undefined, 'timeout');
+    }
+    throw new ApiError('Network error. Please check your connection and try again.', 0, err, 'network');
+  } finally {
+    clearTimeout(timer);
+    callerSignal?.removeEventListener?.('abort', onCallerAbort);
+  }
+}
+
+function hasAuthorizationHeader(headers: Record<string, string>): boolean {
+  return Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
+}
+
+/**
+ * Backend request returning the raw Response (for callers that inspect status
+ * codes or headers). Adds timeout, retry with backoff for idempotent requests,
+ * JWT attachment, and one silent re-auth + retry on 401.
+ */
+export async function apiFetch(path: string, init: ApiRequestInit = {}): Promise<Response> {
+  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries, auth = true, ...requestInit } = init;
+  const url = /^https?:\/\//.test(path)
+    ? path
+    : `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
+  const method = (requestInit.method ?? 'GET').toUpperCase();
+  const maxRetries = retries ?? (method === 'GET' || method === 'HEAD' ? 2 : 0);
+
+  const baseHeaders: Record<string, string> = {
+    'Content-Type': 'application/json',
+    ...((requestInit.headers as Record<string, string> | undefined) ?? {}),
+  };
+  // Never overwrite a caller-supplied Authorization (e.g. engine routes sign requests).
+  const attachJwt = auth && !hasAuthorizationHeader(baseHeaders);
+  let jwt = attachJwt ? await getStoredJwt() : null;
+  let reauthed = false;
+
+  for (let attempt = 0; ; attempt++) {
+    const headers = { ...baseHeaders };
+    if (jwt) headers.Authorization = `Bearer ${jwt}`;
+
+    let response: Response;
     try {
-      body = JSON.parse(text);
-    } catch {
-      body = text;
+      response = await fetchWithTimeout(url, { ...requestInit, headers }, timeoutMs);
+    } catch (err) {
+      if (err instanceof ApiError && attempt < maxRetries) {
+        await sleep(backoffMs(attempt, null));
+        continue;
+      }
+      throw err;
     }
+
+    if (response.status === 401 && jwt && !reauthed) {
+      reauthed = true;
+      const fresh = await refreshJwt();
+      if (fresh) {
+        jwt = fresh;
+        attempt--; // the re-auth retry doesn't count against network retries
+        continue;
+      }
+    }
+
+    if (isRetryableStatus(response.status) && attempt < maxRetries) {
+      await sleep(backoffMs(attempt, response.headers.get('Retry-After')));
+      continue;
+    }
+
+    return response;
   }
+}
+
+async function readBody(response: Response): Promise<unknown> {
+  const text = await response.text();
+  if (!text) return null;
+  try {
+    return JSON.parse(text);
+  } catch {
+    return text;
+  }
+}
+
+function errorMessageFor(status: number, body: unknown): string {
+  if (typeof body === 'object' && body !== null && 'error' in body) {
+    const error = (body as { error: unknown }).error;
+    if (typeof error === 'string') return error;
+  }
+  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
+  if (status >= 500) return 'The service is busy. Please try again shortly.';
+  return `Request failed (${status})`;
+}
+
+/** Backend request that parses JSON and throws ApiError on non-2xx. */
+export async function apiRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
+  const response = await apiFetch(path, init);
+  const body = await readBody(response);
 
   if (!response.ok) {
-    const message =
-      typeof body === 'object' &&
-      body !== null &&
-      'error' in body &&
-      typeof (body as { error: unknown }).error === 'string'
-        ? (body as { error: string }).error
-        : `Request failed (${response.status})`;
-    throw new ApiError(message, response.status, body);
+    throw new ApiError(errorMessageFor(response.status, body), response.status, body);
   }
 
   return body as T;
diff --git a/apps/mobile/src/services/soroban/deposit.ts b/apps/mobile/src/services/soroban/deposit.ts
index 41f7e87..a2ec164 100644
--- a/apps/mobile/src/services/soroban/deposit.ts
+++ b/apps/mobile/src/services/soroban/deposit.ts
@@ -20,6 +20,7 @@ import {
   HORIZON_URL,
 } from '../../constants/stellar';
 import { getOrGenerateDeviceKeypair } from '../wallet/deviceKeyStore';
+import { fetchWithTimeout } from '../api/client';
 
 // Ensure Buffer is available globally for XDR serialization in Hermes.
 if (typeof global.Buffer === 'undefined') {
@@ -251,7 +252,7 @@ async function resolveAccountSequence(publicKey: string): Promise<string> {
 
 async function fetchHorizonSequence(publicKey: string): Promise<string | null> {
   try {
-    const response = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
+    const response = await fetchWithTimeout(`${HORIZON_URL}/accounts/${publicKey}`);
     if (response.status === 404) return null;
     if (!response.ok) return null;
     const data = (await response.json()) as { sequence?: unknown };
diff --git a/apps/mobile/src/services/stellar/anchorService.ts b/apps/mobile/src/services/stellar/anchorService.ts
index b781f2e..cf6b610 100644
--- a/apps/mobile/src/services/stellar/anchorService.ts
+++ b/apps/mobile/src/services/stellar/anchorService.ts
@@ -41,16 +41,18 @@ import {
   Transaction,
 } from '@stellar/stellar-sdk';
 import { Buffer } from 'buffer';
+import { getAnchorDomain } from '../../constants/api';
 import {
   HORIZON_TESTNET_URL,
   PIJIN_ASSETS,
   type AssetCode,
 } from './trustlineService';
+import { fetchWithTimeout } from '../api/client';
 
 // ─── Constants ────────────────────────────────────────────────────────────────
 
-/** Base URL of the Pijin anchor backend (no trailing slash). */
-export const ANCHOR_DOMAIN = process.env.EXPO_PUBLIC_ANCHOR_DOMAIN || 'pijin-api.vercel.app';
+/** Base URL of the Pijin anchor backend (no trailing slash). Same host as the API unless overridden. */
+export const ANCHOR_DOMAIN = getAnchorDomain();
 export const ANCHOR_BASE_URL = `https://${ANCHOR_DOMAIN}`;
 
 /** Stellar network we are targeting. */
@@ -141,7 +143,7 @@ export async function confirmSep24WithdrawalPayment(
 ): Promise<void> {
   let response: Response;
   try {
-    response = await fetch(`${ANCHOR_BASE_URL}/api/anchor/confirm-withdraw`, {
+    response = await fetchWithTimeout(`${ANCHOR_BASE_URL}/api/anchor/confirm-withdraw`, {
       method: 'POST',
       headers: {
         Authorization: `Bearer ${token}`,
@@ -259,7 +261,7 @@ export async function getSep24WithdrawalInstructions(
   for (let attempt = 1; attempt <= 5; attempt += 1) {
     let response: Response;
     try {
-      response = await fetch(endpoint, {
+      response = await fetchWithTimeout(endpoint, {
         headers: { Authorization: `Bearer ${token}` },
       });
     } catch (err) {
@@ -366,7 +368,7 @@ export async function submitSep24WithdrawalPayment(
     transaction.sign(userKeypair);
 
     const txBase64 = transactionToBase64(transaction);
-    const response = await fetch(`${HORIZON_TESTNET_URL}/transactions`, {
+    const response = await fetchWithTimeout(`${HORIZON_TESTNET_URL}/transactions`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
       body: `tx=${encodeURIComponent(txBase64)}`,
@@ -411,7 +413,7 @@ async function fetchAnchorEndpoints(): Promise<AnchorEndpoints> {
 
   let response: Response;
   try {
-    response = await fetch(tomlUrl);
+    response = await fetchWithTimeout(tomlUrl);
   } catch (err) {
     throw new AnchorServiceError(
       'Could not reach the Pijin anchor. Please check your internet connection.',
@@ -462,7 +464,7 @@ async function fetchSep10Challenge(
   try {
     const url = new URL(webAuthEndpoint);
     url.searchParams.set('account', publicKey);
-    response = await fetch(url.toString());
+    response = await fetchWithTimeout(url.toString());
   } catch (err) {
     throw new AnchorServiceError(
       'Failed to connect to the authentication server.',
@@ -554,7 +556,7 @@ async function submitSignedChallenge(
 ): Promise<string> {
   let response: Response;
   try {
-    response = await fetch(webAuthEndpoint, {
+    response = await fetchWithTimeout(webAuthEndpoint, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ transaction: signedXdr }),
@@ -614,7 +616,7 @@ async function initiateSep24Deposit(
 
   let response: Response;
   try {
-    response = await fetch(depositUrl, {
+    response = await fetchWithTimeout(depositUrl, {
       method: 'POST',
       headers: {
         Authorization: `Bearer ${token}`,
@@ -667,7 +669,7 @@ async function initiateSep24Withdrawal(
 
   let response: Response;
   try {
-    response = await fetch(withdrawalUrl, {
+    response = await fetchWithTimeout(withdrawalUrl, {
       method: 'POST',
       headers: { Authorization: `Bearer ${token}` },
       body: formData,
diff --git a/apps/mobile/src/services/stellar/trustlineService.ts b/apps/mobile/src/services/stellar/trustlineService.ts
index c9018da..079d2a7 100644
--- a/apps/mobile/src/services/stellar/trustlineService.ts
+++ b/apps/mobile/src/services/stellar/trustlineService.ts
@@ -17,6 +17,7 @@ import {
   Operation,
   TransactionBuilder,
 } from '@stellar/stellar-sdk';
+import { fetchWithTimeout } from '../api/client';
 
 // ─── Constants ───────────────────────────────────────────────────────────────
 
@@ -136,7 +137,7 @@ export async function ensureTrustline(
   }
 
   // Submit to Testnet Horizon manually using fetch.
-  const response = await fetch(`${HORIZON_TESTNET_URL}/transactions`, {
+  const response = await fetchWithTimeout(`${HORIZON_TESTNET_URL}/transactions`, {
     method: 'POST',
     headers: {
       'Content-Type': 'application/x-www-form-urlencoded',
diff --git a/apps/mobile/src/services/syncService.ts b/apps/mobile/src/services/syncService.ts
index 8dede3c..ea2e725 100644
--- a/apps/mobile/src/services/syncService.ts
+++ b/apps/mobile/src/services/syncService.ts
@@ -32,29 +32,59 @@ import type { PaymentQueueRow } from '../db/schema';
 import { addTransaction, upsertServerTransactions, upsertHistoryTransactions } from '../db/services/transactionDb';
 import { loadStoredAccount } from './storage/accountStorage';
 import { getUserSettlements, getWalletHistory } from './api/transactions';
-import { getApiBaseUrl } from '../constants/api';
+import { apiFetch } from './api/client';
 
 // ---------------------------------------------------------------------------
 // Backend integration point
 // ---------------------------------------------------------------------------
 
+/** Max queue items posted per flush, so a reconnecting crowd doesn't flood the relayer. */
+const MAX_ITEMS_PER_FLUSH = 5;
+/** Random delay before an automatic flush, so devices regaining signal together spread out. */
+const MAX_AUTO_FLUSH_JITTER_MS = 3_000;
+
+/**
+ * Why a post did not settle:
+ *  - 'transient': network, timeout, 408/429/5xx — keep pending, stop this flush.
+ *  - 'rejected':  401/403 — the backend refused a direct submission (settle is
+ *                 QStash-signed); keep pending so the SMS path can still settle it.
+ *  - 'permanent': 400/413/422 — the payload itself is bad; never retry.
+ */
+export class SyncPostError extends Error {
+  constructor(message: string, public readonly kind: 'transient' | 'rejected' | 'permanent') {
+    super(message);
+    this.name = 'SyncPostError';
+  }
+}
+
+export function classifySettleStatus(status: number): SyncPostError['kind'] {
+  if (status === 401 || status === 403) return 'rejected';
+  if (status === 400 || status === 413 || status === 422) return 'permanent';
+  return 'transient';
+}
+
 /**
  * Sends a single queued payment to the backend Settlement endpoint.
  */
 async function postToBackend(
   item: PaymentQueueRow
 ): Promise<{ txHash: string | null; status: string; error?: string }> {
-  const apiBase = getApiBaseUrl();
-  const res = await fetch(`${apiBase}/api/engine/settle`, {
-    method: 'POST',
-    headers: { 'Content-Type': 'application/json' },
-    // /api/engine/settle expects `smsPayload` (not `smsBody`)
-    // and `senderPhone` for SMS receipt notifications.
-    body: JSON.stringify({
-      smsPayload: item.smsBody,
-      senderPhone: null, // No phone available in mobile context; backend handles gracefully
-    }),
-  });
+  let res: Response;
+  try {
+    res = await apiFetch('/api/engine/settle', {
+      method: 'POST',
+      auth: false,
+      timeoutMs: 25_000,
+      // /api/engine/settle expects `smsPayload` (not `smsBody`)
+      // and `senderPhone` for SMS receipt notifications.
+      body: JSON.stringify({
+        smsPayload: item.smsBody,
+        senderPhone: null, // No phone available in mobile context; backend handles gracefully
+      }),
+    });
+  } catch (err) {
+    throw new SyncPostError(err instanceof Error ? err.message : 'Network error', 'transient');
+  }
 
   if (res.status === 409) {
     // Duplicate nonce — idempotent success
@@ -62,7 +92,7 @@ async function postToBackend(
   }
 
   if (!res.ok) {
-    throw new Error(`Backend returned HTTP ${res.status}`);
+    throw new SyncPostError(`Backend returned HTTP ${res.status}`, classifySettleStatus(res.status));
   }
 
   const data = await res.json();
@@ -103,7 +133,7 @@ class SyncService {
         if (this.isFlushInProgress) {
           return EMPTY;
         }
-        return from(this.flush()).pipe(
+        return from(this.flush({ jitter: true })).pipe(
           catchError(err => {
             console.error('[SyncService] Unhandled flush error:', err);
             return EMPTY;
@@ -142,13 +172,17 @@ class SyncService {
    * Called automatically on online transition, but can also be invoked
    * from the "Sync Now" button in DashboardScreen as a manual override.
    */
-  async flush(): Promise<void> {
+  async flush(options: { jitter?: boolean } = {}): Promise<void> {
     if (this.isFlushInProgress) {
       return;
     }
 
     this.isFlushInProgress = true;
     try {
+      if (options.jitter) {
+        await new Promise((resolve) => setTimeout(resolve, Math.random() * MAX_AUTO_FLUSH_JITTER_MS));
+      }
+
       let account: any = null;
       try {
         account = await loadStoredAccount();
@@ -180,6 +214,10 @@ class SyncService {
       let successCount = 0;
       let totalAmount = 0;
 
+      // Already-settled items are reconciled locally without a request, so they
+      // don't count against the per-flush budget.
+      let posted = 0;
+
       for (const item of pending) {
         try {
           const shortNonce = this.extractShortNonce(item.smsBody);
@@ -192,9 +230,14 @@ class SyncService {
             continue;
           }
 
+          if (posted >= MAX_ITEMS_PER_FLUSH) {
+            continue;
+          }
+
           let isFailed = false;
           let errorMessage = '';
 
+          posted++;
           const result = await postToBackend(item);
           if (result.status === 'FAILED') {
             isFailed = true;
@@ -214,8 +257,23 @@ class SyncService {
         } catch (err: any) {
           const message = err?.message ?? 'Unknown error';
           await markSyncError(item.id, message);
+
+          if (err instanceof SyncPostError && err.kind === 'permanent') {
+            // Malformed voucher: retrying can never succeed.
+            await markSynced(item.id, null, 'FAILED');
+            console.warn(`[SyncService] Item ${item.id} permanently rejected: ${message}`);
+            continue;
+          }
+
+          if (err instanceof SyncPostError) {
+            // Transient or rejected: keep the item pending and stop hammering the
+            // backend this round. The next flush (or SMS settlement) picks it up.
+            console.warn(`[SyncService] Item ${item.id} not settled (${err.kind}): ${message}. Stopping this flush.`);
+            break;
+          }
+
           console.warn(`[SyncService] Item ${item.id} failed: ${message}`);
-          // Continue processing remaining items — do not abort the whole flush
+          // Unexpected local error — continue with the remaining items
         }
       }
     } finally {
diff --git a/apps/mobile/src/services/wallet/offlineKeySync.ts b/apps/mobile/src/services/wallet/offlineKeySync.ts
index a83f123..ea205a2 100644
--- a/apps/mobile/src/services/wallet/offlineKeySync.ts
+++ b/apps/mobile/src/services/wallet/offlineKeySync.ts
@@ -5,6 +5,7 @@ import {
   getOrGenerateDeviceKeypair,
   markDeviceKeyEnrolled,
 } from './deviceKeyStore';
+import { apiFetch, fetchWithTimeout } from '../api/client';
 
 type PrepareResponse =
   | { status: 'synced' }
@@ -21,7 +22,8 @@ async function keyRequest<T>(
   jwt: string,
   offlineDeviceKey: string,
 ): Promise<T> {
-  const response = await fetch(`${getApiBaseUrl()}/api/engine/offline-key`, {
+  const response = await apiFetch(`${getApiBaseUrl()}/api/engine/offline-key`, {
+    timeoutMs: 25_000,
     method,
     headers: {
       'Content-Type': 'application/json',
@@ -42,7 +44,7 @@ async function submitAndConfirm(xdrEnvelope: string, mainWallet: Keypair): Promi
   const transaction = TransactionBuilder.fromXDR(xdrEnvelope, networkPassphrase);
   transaction.sign(mainWallet);
 
-  const submitted = await fetch(rpcUrl, {
+  const submitted = await fetchWithTimeout(rpcUrl, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
@@ -65,7 +67,7 @@ async function submitAndConfirm(xdrEnvelope: string, mainWallet: Keypair): Promi
 
   for (let attempt = 0; attempt < 20; attempt++) {
     await new Promise<void>((resolve) => setTimeout(resolve, 1500));
-    const polled = await fetch(rpcUrl, {
+    const polled = await fetchWithTimeout(rpcUrl, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
diff --git a/apps/mobile/src/services/wallet/recipientRegistrySync.ts b/apps/mobile/src/services/wallet/recipientRegistrySync.ts
index 1822882..c1d9619 100644
--- a/apps/mobile/src/services/wallet/recipientRegistrySync.ts
+++ b/apps/mobile/src/services/wallet/recipientRegistrySync.ts
@@ -3,6 +3,7 @@ import {
   OfflineProtocolConfig,
   saveOfflineProtocolConfig,
 } from '../storage/offlineProtocolStorage';
+import { apiFetch } from '../api/client';
 
 type RegistryResponse = {
   status: 'registered' | 'already_registered';
@@ -12,7 +13,8 @@ type RegistryResponse = {
 
 /** Ensure this account is payable by short ID and cache its offline signing configuration. */
 export async function synchronizeRecipientRegistry(jwt: string): Promise<void> {
-  const response = await fetch(`${getApiBaseUrl()}/api/engine/recipient-registry`, {
+  const response = await apiFetch(`${getApiBaseUrl()}/api/engine/recipient-registry`, {
+    timeoutMs: 25_000,
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
```

</details>

<details><summary>New files</summary>

```diff
diff --git a/apps/mobile/src/components/ErrorBoundary.tsx b/apps/mobile/src/components/ErrorBoundary.tsx
new file mode 100644
index 0000000..d792418
--- /dev/null
+++ b/apps/mobile/src/components/ErrorBoundary.tsx
@@ -0,0 +1,90 @@
+import React from 'react';
+import { ScrollView, StyleSheet, Text, View } from 'react-native';
+import { SafeAreaView } from 'react-native-safe-area-context';
+import { AppButton } from './ui/AppButton';
+import { reportError } from '../services/errorReporting';
+
+type Props = { children: React.ReactNode };
+type State = { error: Error | null; resetKey: number };
+
+/**
+ * Catches render/lifecycle errors anywhere below it and shows a recovery screen
+ * instead of a blank app. "Try again" remounts the tree; wallet keys and the
+ * offline queue live in SecureStore/SQLite, so nothing is lost.
+ */
+export class ErrorBoundary extends React.Component<Props, State> {
+  state: State = { error: null, resetKey: 0 };
+
+  static getDerivedStateFromError(error: Error): Partial<State> {
+    return { error };
+  }
+
+  componentDidCatch(error: Error, info: React.ErrorInfo): void {
+    reportError(error, { source: 'ErrorBoundary', componentStack: info.componentStack });
+  }
+
+  private handleReset = () => {
+    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
+  };
+
+  render() {
+    const { error, resetKey } = this.state;
+
+    if (error) {
+      return (
+        <SafeAreaView style={styles.container}>
+          <View style={styles.content} accessibilityRole="alert">
+            <Text style={styles.title}>Something went wrong</Text>
+            <Text style={styles.body}>
+              Pijin hit an unexpected problem. Your wallet and any offline payments are safe on this device.
+            </Text>
+            {__DEV__ && (
+              <ScrollView style={styles.devBox}>
+                <Text style={styles.devText}>{error.message}</Text>
+              </ScrollView>
+            )}
+            <AppButton title="Try again" onPress={this.handleReset} style={styles.button} />
+          </View>
+        </SafeAreaView>
+      );
+    }
+
+    return <React.Fragment key={resetKey}>{this.props.children}</React.Fragment>;
+  }
+}
+
+const styles = StyleSheet.create({
+  container: {
+    flex: 1,
+    backgroundColor: '#FFFFFF',
+  },
+  content: {
+    flex: 1,
+    justifyContent: 'center',
+    paddingHorizontal: 24,
+    gap: 12,
+  },
+  title: {
+    fontSize: 22,
+    fontWeight: '700',
+    color: '#111111',
+  },
+  body: {
+    fontSize: 15,
+    lineHeight: 22,
+    color: '#4B5563',
+  },
+  devBox: {
+    maxHeight: 160,
+    backgroundColor: '#F3F4F6',
+    borderRadius: 8,
+    padding: 12,
+  },
+  devText: {
+    fontSize: 12,
+    color: '#B91C1C',
+  },
+  button: {
+    marginTop: 12,
+  },
+});
diff --git a/apps/mobile/src/services/errorReporting.ts b/apps/mobile/src/services/errorReporting.ts
new file mode 100644
index 0000000..7f24434
--- /dev/null
+++ b/apps/mobile/src/services/errorReporting.ts
@@ -0,0 +1,33 @@
+/**
+ * @file src/services/errorReporting.ts
+ *
+ * Single place where crashes are reported. Today it logs; when Sentry is added
+ * (@sentry/react-native + DSN + new EAS build), call Sentry.captureException
+ * inside `reportError` and nothing else needs to change.
+ */
+
+type ErrorContext = Record<string, unknown>;
+
+export function reportError(error: unknown, context: ErrorContext = {}): void {
+  const err = error instanceof Error ? error : new Error(String(error));
+  console.error('[ErrorReporting]', err.message, { ...context, stack: err.stack });
+}
+
+let installed = false;
+
+/** Reports uncaught JS errors (outside React render) before the default handler runs. */
+export function installGlobalErrorHandler(): void {
+  if (installed) return;
+  const errorUtils = (globalThis as { ErrorUtils?: {
+    getGlobalHandler: () => (error: Error, isFatal?: boolean) => void;
+    setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
+  } }).ErrorUtils;
+  if (!errorUtils) return;
+
+  const previous = errorUtils.getGlobalHandler();
+  errorUtils.setGlobalHandler((error, isFatal) => {
+    reportError(error, { source: 'global', isFatal: Boolean(isFatal) });
+    previous(error, isFatal);
+  });
+  installed = true;
+}
```

</details>
