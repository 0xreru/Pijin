import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const ASYNC_KEYS = [
  'onboarding_complete',
  'user_pin',
  'user_phone',
  'user_first_name',
  'user_last_name',
  'user_email',
  'registered_phones',
  'cached_balance',
  'offline_balance',
  'initial_reset_v2',
  'is_online',
  'account',
];

const SECURE_KEYS = [
  'device.secret',
  'user_pin_secure',
];

let migrationPromise: Promise<void> | null = null;

export function ensureMigration(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      try {
        const migrated = await AsyncStorage.getItem('pijn.storage_migrated');
        if (migrated === 'true') {
          return;
        }

        console.log('[Migration] Running one-time storage keys migration to pijn.*...');

        // Migrate AsyncStorage keys
        for (const key of ASYNC_KEYS) {
          try {
            let targetValue = await AsyncStorage.getItem(`pijn.${key}`);
            if (targetValue === null) {
              const abotperaValue = await AsyncStorage.getItem(`abotpera.${key}`);
              if (abotperaValue !== null) {
                await AsyncStorage.setItem(`pijn.${key}`, abotperaValue);
                targetValue = abotperaValue;
                console.log(`[Migration] Migrated AsyncStorage key: abotpera.${key} -> pijn.${key}`);
              }
            }
            if (targetValue === null) {
              const pijinValue = await AsyncStorage.getItem(`pijin.${key}`);
              if (pijinValue !== null) {
                await AsyncStorage.setItem(`pijn.${key}`, pijinValue);
                targetValue = pijinValue;
                console.log(`[Migration] Migrated AsyncStorage key: pijin.${key} -> pijn.${key}`);
              }
            }

            // Remove legacy keys
            await AsyncStorage.removeItem(`abotpera.${key}`).catch(() => {});
            await AsyncStorage.removeItem(`pijin.${key}`).catch(() => {});
          } catch (e) {
            console.warn(`[Migration] Failed to migrate AsyncStorage key ${key}:`, e);
          }
        }

        // Migrate SecureStore keys
        for (const key of SECURE_KEYS) {
          try {
            let targetValue = await SecureStore.getItemAsync(`pijn.${key}`);
            if (targetValue === null) {
              const abotperaValue = await SecureStore.getItemAsync(`abotpera.${key}`);
              if (abotperaValue !== null) {
                await SecureStore.setItemAsync(`pijn.${key}`, abotperaValue);
                targetValue = abotperaValue;
                console.log(`[Migration] Migrated SecureStore key: abotpera.${key} -> pijn.${key}`);
              }
            }
            if (targetValue === null) {
              const pijinValue = await SecureStore.getItemAsync(`pijin.${key}`);
              if (pijinValue !== null) {
                await SecureStore.setItemAsync(`pijn.${key}`, pijinValue);
                targetValue = pijinValue;
                console.log(`[Migration] Migrated SecureStore key: pijin.${key} -> pijn.${key}`);
              }
            }

            // Remove legacy keys
            await SecureStore.deleteItemAsync(`abotpera.${key}`).catch(() => {});
            await SecureStore.deleteItemAsync(`pijin.${key}`).catch(() => {});
          } catch (e) {
            console.warn(`[Migration] Failed to migrate SecureStore key ${key}:`, e);
          }
        }

        await AsyncStorage.setItem('pijn.storage_migrated', 'true');
        await AsyncStorage.removeItem('pijin.storage_migrated').catch(() => {});
        console.log('[Migration] Storage keys migration completed successfully.');
      } catch (err) {
        console.error('[Migration] Critical error running migration:', err);
      }
    })();
  }
  return migrationPromise;
}
