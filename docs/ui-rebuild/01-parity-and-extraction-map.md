# UI Rebuild: Parity Checklist and Logic Extraction Map

Baseline: git tag `legacy-ui-v1`. Working branch: `rebuild/ui-v2`.
Generated from a **static scan** of `apps/mobile` (imports, hook counts). Confirm each row when reading the screen in Phase 1.

## Findings that change the plan

- **Merchant POS UI is dead code.** `components/merchant/*` (13 files + `MerchantPosScanner`) and `MerchantBottomNavBar` are 24-line placeholders that nothing imports. `UserMode = 'customer' | 'merchant'` exists in `AuthContext`, but no screen uses it. `ScanTab.tsx` is a simulation alert. Decision needed: drop merchant for v2, or design it as a new feature.
- **Only 12 components are used by screens** (`ConnectionWatcher`, `ErrorModal`, `OfflineSuccessModal`, `AppButton`, `OfflineNoticeModal`, `CountryCodePicker`, `BottomNavBar`, `AppPinInput`, `BalanceCard`, `DepositButton`, `DashboardHeader`, `TransactionList`). All other components are unused stubs and can be deleted now.
- **Screens call `db`, `services` and `apiFetch` directly.** There is no hook layer, so the logic has to be extracted (Phase 1) before the UI is deleted.
- **Debug/dev code in production screens:** `DashboardScreen` (mock payload enqueue near line 494, `clearPaymentQueue`, `clearTransactions`, `correctLegacyTags`), `debugSmsSend` in `ScanQRScreen` and `TransportChoiceScreen`. Gate these behind `__DEV__` or drop them in v2.
- **Duplicated screens:** `LoadOfflineFundsScreen` (1081 lines) and `LoadOnlineFundsScreen` (1062 lines) both import `apiFetch`/`fetchWithTimeout` and likely share most logic.
- **Backend tests** live in `apps/backend/scripts` (`e2e-live-test.ts`, `test-demo-*.ts`, `test-sms-webhook.ts`, `verify-*.ts`). They cover the server, not the mobile logic. Mobile has no tests.

## Extraction map (screen to hook)

Logic stays in `services/`, `db/` and `utils/`. Each new hook returns `{ state, actions }` with no JSX. Screens in v2 become thin composition.

| Screen (lines) | What it touches | Target hook | Notes |
|---|---|---|---|
| OnboardingScreen (1450) | accounts API, deviceKeyStore, offlineKeySync, recipientRegistrySync, SEP-10 + trustline, mnemonic, secure clipboard, migration, 23 useState | `useOnboarding` (split: `usePhoneStep`, `useMnemonicStep`, `usePinStep`, `useRegistration`) | Highest risk. Wallet creation. Keep step order and the secure-screen flag. |
| SignInScreen (480) | verifyPinWithServer, SEP-10, stored account, key and registry sync | `useSignIn` | |
| RestoreWalletScreen (275) | mnemonic derive, checkUserExists, SEP-10, trustline, syncs | `useRestoreWallet` | Shares steps with onboarding. Merge into a `useWalletSetup` core. |
| DashboardScreen (696) + 4 tabs | vault balance, db, paymentQueue, syncService, connectionService, migration | `useDashboard`, `useHomeData`, `useTransactionsList`, `useNotifications` | Strip debug code. Cleanup of sync/connection subscriptions matters. |
| HomeTab (503) | trustline (ensureTrustline), main wallet secret | `useHome` / `useTrustlineSetup` | Touches the wallet secret. |
| SendMoneyScreen (925) | phone lookup, vault balance, paymentQueue db, 14 useState | `useSendMoney` | Amount, recipient lookup and validation. |
| SendMoneyConfirmScreen (1339) | online transfer API, enqueuePayment, stored account, apiFetch | `useSendConfirm` | Online vs offline branch. Needs tests. |
| ScanQRScreen (424) | camera, enqueuePayment, SMS debug | `useScanQR` | Camera permission flow. |
| TransportChoiceScreen (377) | SMS URL, addTransaction, enqueuePayment | `useTransportChoice` | SMS gateway. Android and iOS differ. |
| GenerateQRScreen (554) | user lookup, enqueue, addTransaction, name storage | `useGenerateQR` | |
| LoadOnlineFundsScreen / LoadOfflineFundsScreen (1062 / 1081) | apiFetch, fetchWithTimeout | `useLoadFunds` (shared, parameterised by mode) | Likely mostly duplicated. Diff them first. |
| Sep24WebviewScreen (977) | anchor webview, main wallet secret | `useSep24Session` | Injects/uses the wallet secret. Review carefully. |
| TransactionReceiptScreen (390) | none (route param) | none | Pure UI. |
| ChangePinScreen (183) | PIN change | `useChangePin` | |
| AccountSettings / VaultSettings / ProfileTab | storage getters | `useProfile` | Small. |
| NotificationsTab (442) | local state | `useNotifications` | Check whether the data is real or mock. |

## Parity checklist (each box ticked in v2 on a real device)

Format: flow, then acceptance check.

**Onboarding and wallet**
- [ ] New user: phone, name, mnemonic shown (screenshot blocked), mnemonic confirmed, PIN set, account registered, trustline created, device key and registry synced, then Dashboard
- [ ] Mnemonic copy uses secure clipboard (auto-clear)
- [ ] Country code picker + E.164 formatting
- [ ] Restore wallet from mnemonic to the same address
- [ ] Sign-in with PIN (wrong PIN, lockout/error messages)
- [ ] Logout confirmation

**Dashboard**
- [ ] Home: balance (online + offline vault), top-up button only when `EXPO_PUBLIC_TOPUP_ENABLED=true`
- [ ] Transactions list: pending / settled states, receipt navigation
- [ ] Notifications tab
- [ ] Profile tab
- [ ] Connection watcher: offline banner, auto-sync on reconnect

**Payments**
- [ ] Send, online: lookup by phone or short id, amount, confirm, receipt
- [ ] Send, offline: signed payload queued, QR or SMS transport, queue flushes on reconnect
- [ ] Offline success modal and offline notice modal
- [ ] Scan QR (camera permission denied, granted, blocked)
- [ ] Transport choice (SMS opens the composer with the gateway number)
- [ ] Generate QR (receiver and relay modes), save to gallery, share
- [ ] Insufficient balance and invalid amount errors

**Funds**
- [ ] Load online funds (SEP-24 deposit in the webview, return state)
- [ ] Load offline funds (move to vault)
- [ ] Vault settings

**Settings and compliance**
- [ ] Change PIN
- [ ] Account settings
- [ ] Privacy page and delete account

**Platform**
- [ ] Android back button on every screen
- [ ] Keyboard does not cover inputs (`softwareKeyboardLayoutMode: pan`)
- [ ] Safe areas and notches, large font scale
- [ ] Cold start on a low-end Android release build
- [ ] iOS: camera, photo-library and SMS permission strings

## Decisions still needed

1. Merchant mode: drop it for v2, or design it?
2. Are `NotificationsTab` and `ScanTab` real features or mocks?
3. Is there anywhere the old UI must stay reachable (a hotfix build from `legacy-ui-v1` only)?
