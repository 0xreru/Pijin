# Clean slate state (branch `rebuild/ui-v2`)

The full old Pijin UI is preserved at git tag **`legacy-ui-v1`**
(`git show legacy-ui-v1:apps/mobile/src/screens/SendMoneyScreen.tsx`, or `git worktree add ../legacy legacy-ui-v1`).
Not all screen logic was extracted before deletion (see `01-parity-and-extraction-map.md`). When rebuilding a flow, read its old screen from the tag.

## Kept (no UI dependency)
`src/services`, `src/db`, `src/utils`, `src/context/AuthContext`, `src/hooks`, `src/types`, `src/constants` (api, stellar, network, featureFlags, countries), `src/features/auth` (sign-in, restore wallet, change PIN hooks).

## Removed
All screens and components, and the old design tokens (`theme`, `typography`, `spacing`, `radius`), the mock transactions hook, and the merchant stubs.

## Shell
`App.tsx` runs storage and SQLite migrations, starts `syncService`, wraps `AuthProvider` and `ErrorBoundary`, and shows `PlaceholderScreen`. Add routes to `RootStackParamList`.

## Renamed to HoneBill (display only)
`app.json` name, error boundary and startup text, WalletConnect metadata name and description, anchor error message.

## Deliberately still "Pijin" (change as a separate, planned step)
| Identifier | Where | Why it was left |
|---|---|---|
| Storage keys `pijn.*` / `pijin.*`, SecureStore `pijn.device.secret`, `pijn.main_wallet.secret` | `services/storage/*`, `deviceKeyStore.ts`, `useVaultBalance.ts`, `connectionService.ts` | Renaming orphans stored wallet secrets, PINs and the offline queue on existing installs. Needs a migration (see `storage/migration.ts`). |
| `pijin.db` | `db/client.ts` | Same: existing local transactions and payment queue. |
| `live.pijin.app` Android package, `pijin://` scheme, `pijin-app` slug | `app.json` | Store identity and deep links. Changing the package id creates a new app for Play and installs. |
| `pijin-api.vercel.app`, `preview-pijin.vercel.app`, `pijin.app` | `constants/api.ts`, `eas.json`, WalletConnect url | Live backend hosts. Change with the backend domain. |
| `pijin_core` package, `PIJIN_ASSETS`, `PijinContract` | `packages/`, services, backend, contracts | Internal names. Rename together across the monorepo. |
| `package.json` name `pijin` | `apps/mobile` | Workspace name, affects lockfile. |
| Backend web pages | `apps/backend/app/**` | Marketing site, privacy policy, delete-account page text. |

## Known issues deliberately not fixed
- Change PIN updates only the local PIN, not the server's.
- Sign-in calls `checkUserExists` with the `phoneNumber` state, which can be empty if it hasn't loaded yet.
