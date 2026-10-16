# Expo SDK 54 / Android API 36 upgrade procedure

## Outcome

The Android production AAB was successfully built with Expo SDK 54 and Android target API 36. The generated artifact has **not** been uploaded to Google Play; device validation remains before release.

| Setting | Result |
| --- | --- |
| Android package | \`com.anonymous.pijinapp\` |
| Marketing version | \`1.0.0\` |
| EAS profile | \`production\` |
| EAS version source | Remote versioning |
| Completed Android version code | \`5\` |
| Expo SDK / React Native / React | \`54.0.0\` / \`0.81.5\` / \`19.1.0\` |
| Android target / compile SDK | \`36\` |
| Minimum Android SDK | \`24\` |

## Starting point and migration scope

\`apps/mobile\` was an Expo SDK 52 bare/native app with a committed Android project. Google Play rejected new submissions because it targeted API 34. The work upgraded only to SDK 54, the chosen stable Expo baseline supporting API 36; it did not force an unsupported SDK 52 override and did not move to a newer SDK.

The existing EAS owner/project link changes in \`apps/mobile/app.json\`, signing configuration, app ID, version, permissions, and remote-versioning setup were preserved. \`expo prebuild --clean\` was not run, so the committed native project was not regenerated or overwritten.

## Commands executed

Run from \`apps/mobile\` unless noted otherwise.

### Upgrade and dependency alignment

\`\`\`powershell
npx expo install expo@~54.0.0
npx expo install --fix
\`\`\`

The first command moved Expo to the SDK 54 release line. The second aligned Expo-managed packages to the SDK rather than refreshing unrelated libraries to latest versions.

### Verification

\`\`\`powershell
npx expo-doctor
npx tsc --noEmit
npm ls --workspace=pijin expo react react-native react-native-worklets @types/react
git diff --check
\`\`\`

### Local Android build checks

\`\`\`powershell
cd apps/mobile/android
.\gradlew.bat :app:createBundleReleaseJsAndAssets
.\gradlew.bat :app:processReleaseMainManifest
.\gradlew.bat :app:bundleRelease
\`\`\`

The JavaScript bundle and release-manifest tasks passed. The full local bundle progressed through the large New Architecture native compile but hit the local command time limit; the subsequent EAS cloud production build completed successfully.

### EAS checks and build

\`\`\`powershell
cd apps/mobile
npx eas-cli@latest whoami
npx eas-cli@latest build:version:get -p android
npx eas-cli@latest build -p android --profile production --non-interactive
npx eas-cli@latest build:list -p android --limit 1 --json
npx eas-cli@latest build:view 48672c62-9398-499d-b053-b177a1bc441d --json
\`\`\`

## Files changed and fixes

### Package and app configuration

- \`apps/mobile/package.json\` and the root \`package-lock.json\` were updated through Expo’s installer. The mobile dependency set now resolves Expo \`54.0.37\`, React Native \`0.81.5\`, React \`19.1.0\`, \`react-native-worklets\` \`0.5.1\`, and \`@types/react\` \`19.1.17\`.
- The root \`package.json\` overrides pinning Expo 52, React Native 0.76, and Metro 0.80 were removed, preventing SDK 52-era packages from overriding the SDK 54 dependency graph.
- \`react-native-worklets\` was added because SDK 54’s New Architecture setup requires it.
- \`newArchEnabled: true\` was kept, preserving existing architecture behavior.
- \`apps/mobile/app.json\` now enables \`reactCompiler\` and \`autolinkingModuleResolution\` to use SDK 54-compatible Metro/autolinking behavior.

### Android native configuration

| File | Change | Reason |
| --- | --- | --- |
| \`apps/mobile/android/build.gradle\` | Compile and target SDK set to \`36\`; build tools \`36.0.0\` | Satisfies Google Play’s API 36 requirement. |
| Same | Kotlin \`2.0.21\` | Required by the SDK 54/Compose build. |
| Same | NDK \`27.0.12077973\` | Required by React Native 0.81 C++ compilation. |
| \`android/gradle/wrapper/gradle-wrapper.properties\` | Gradle \`8.13\` | Required by the SDK 54 Android Gradle plugin. |
| \`android/app/build.gradle\` | Explicit mobile root and Expo Node wrapper | Keeps release bundling rooted at \`apps/mobile\`. |

\`minSdkVersion\` remains \`24\`.

### Metro and release-bundle fixes

SDK 54 uses first-class monorepo support. Legacy manual Metro settings—\`watchFolders\`, \`nodeModulesPaths\`, and \`disableHierarchicalLookup\`—were removed from \`apps/mobile/metro.config.js\`. The old hierarchical-lookup setting caused Metro to fail resolving nested \`is-arrayish\` inside \`simple-swizzle\`. Existing Stellar and application aliases remain.

SDK 54 initially used the repository root for the Android Gradle bundle task, causing the app entry file to resolve from the wrong directory. A new \`apps/mobile/scripts/expo-node.js\` wrapper runs Node with \`EXPO_NO_METRO_WORKSPACE_ROOT=1\`; \`android/app/build.gradle\` invokes it for Expo bundling. After this change the release JS bundle passed.

### Source correction discovered by type checking

In \`apps/mobile/src/screens/RestoreWalletScreen.tsx\`:

- Removed a stale import of nonexistent \`saveDeviceKey\`.
- Strengthened the restore guard to require \`exists\`, \`stellarPublicKey\`, and \`shortId\` before calling \`login\`.

This made the TypeScript check pass and prevents incomplete account state reaching login.

### EAS upload-cache fix

The first EAS build submission could not be archived because a locked generated file under \`apps/mobile/android/.gradle\` was included. This was a local Gradle cache problem, not a source or cloud compilation failure.

The following generated folders were added to \`.gitignore\`:

\`\`\`text
apps/mobile/android/.gradle/
apps/mobile/android/build/
apps/mobile/android/app/.cxx/
apps/mobile/android/app/build/
\`\`\`

The retry then uploaded and built successfully. Because EAS remote auto-increment reserves a code at request time, the failed first submission consumed version code 4; the completed AAB uses version code 5.

## Validation evidence

1. \`npx tsc --noEmit\` passed.
2. \`git diff --check\` passed (only line-ending notices were printed).
3. \`:app:createBundleReleaseJsAndAssets\` passed and bundled 1,935 modules.
4. \`:app:processReleaseMainManifest\` passed. The merged release manifest confirms \`package="com.anonymous.pijinapp"\`, \`minSdkVersion=24\`, and \`targetSdkVersion=36\`.
5. Dependency resolution confirms the Expo 54 / RN 0.81 / React 19.1 / Worklets set in the mobile workspace.
6. EAS build \`48672c62-9398-499d-b053-b177a1bc441d\` finished:
   - Android, \`production\`, store distribution
   - SDK \`54.0.0\`
   - package \`com.anonymous.pijinapp\`
   - app/build version \`1.0.0\` / \`5\`
   - AAB: https://expo.dev/artifacts/eas/ZQDjKkQgSGGV49tAut3EQblH4ZQ76rexZygD0mG-SyM.aab

## Expo Doctor notes

\`expo-doctor\` passed 16 of 18 checks. The remaining warnings were intentionally not expanded into unrelated work:

1. The monorepo has mobile React 19.1 for Expo 54 and a root-hoisted React 19.2 required by an unrelated backend/Next 16 graph. Mobile resolves its required local React version.
2. Expo warns that \`app.json\` native settings are not automatically synced in a bare project. That is expected because Android is deliberately maintained manually; the required settings were applied directly and verified in the merged manifest.

No broad \`npm audit fix\` or general dependency refresh was run.

## Remaining release procedure

1. Download the completed AAB from the EAS URL.
2. Fresh-install it on Android 16; test login, session restoration, SecureStore/SQLite persistence, camera QR permissions (including deny/retry), WalletConnect deep link, online/offline transactions, and reconnect behavior.
3. Upgrade an installed current Internal Testing build with this artifact and repeat the persistence/session checks.
4. Optionally run a separate iOS EAS build for SDK-level compatibility; do not submit iOS as part of this Android release.
5. After Android validation passes, upload this exact version-code-5 AAB to Google Play **Internal testing**.
6. Confirm Play Console accepts target API 36, then have testers validate both fresh install and upgrade.

Avoid submitting another identical EAS build unless needed: remote auto-increment will reserve another Android version code.

