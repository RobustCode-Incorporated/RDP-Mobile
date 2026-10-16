import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { CachedDeliveriesState, PendingAction, StoredSession } from '../types/api';

/**
 * Storage split:
 * - SecureStore (Keychain / Keystore) holds ONLY the auth session (JWT + email + role).
 *   It has a ~2KB per-value limit on some platforms, so it must never hold lists.
 * - AsyncStorage holds non-secret, potentially large data: the delivery cache and
 *   the offline action queue.
 *
 * Older builds stored the cache and the queue in SecureStore. `migrateLegacyStorage`
 * moves them to AsyncStorage once (guarded by a flag) and deletes the SecureStore copies.
 */
const SESSION_STORAGE_KEY = 'driver-session';
export const DELIVERY_CACHE_STORAGE_KEY = 'driver-deliveries-cache';
export const PENDING_ACTIONS_STORAGE_KEY = 'driver-pending-actions';
export const STORAGE_MIGRATION_FLAG_KEY = 'driver-storage-migrated-v1';

const LEGACY_SECURE_KEYS = [DELIVERY_CACHE_STORAGE_KEY, PENDING_ACTIONS_STORAGE_KEY];

let migrationPromise: Promise<void> | null = null;

async function runLegacyMigration() {
  if (await AsyncStorage.getItem(STORAGE_MIGRATION_FLAG_KEY)) {
    return;
  }

  for (const key of LEGACY_SECURE_KEYS) {
    try {
      const legacyValue = await SecureStore.getItemAsync(key);

      if (legacyValue) {
        // Never overwrite a value already written by the new storage layer.
        const currentValue = await AsyncStorage.getItem(key);

        if (!currentValue) {
          await AsyncStorage.setItem(key, legacyValue);
        }
      }

      await SecureStore.deleteItemAsync(key);
    } catch {
      // A corrupted / unreadable legacy value must not block the app: drop it.
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // ignore
      }
    }
  }

  await AsyncStorage.setItem(STORAGE_MIGRATION_FLAG_KEY, new Date().toISOString());
}

/** Runs the one-time SecureStore -> AsyncStorage migration (memoized per app run). */
export function migrateLegacyStorage() {
  if (!migrationPromise) {
    migrationPromise = runLegacyMigration().catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }

  return migrationPromise;
}

export function resetStorageMigrationForTests() {
  migrationPromise = null;
}

async function readJson<T>(key: string): Promise<T | null> {
  await migrateLegacyStorage();
  const rawValue = await AsyncStorage.getItem(key);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    await AsyncStorage.removeItem(key);
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  await migrateLegacyStorage();
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function saveSession(session: StoredSession) {
  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export async function loadSession() {
  const rawValue = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  return JSON.parse(rawValue) as StoredSession;
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
}

export async function saveDeliveryCache(cache: CachedDeliveriesState) {
  await writeJson(DELIVERY_CACHE_STORAGE_KEY, cache);
}

export async function loadDeliveryCache() {
  return readJson<CachedDeliveriesState>(DELIVERY_CACHE_STORAGE_KEY);
}

export async function clearDeliveryCache() {
  await migrateLegacyStorage();
  await AsyncStorage.removeItem(DELIVERY_CACHE_STORAGE_KEY);
}

export async function savePendingActions(actions: PendingAction[]) {
  await writeJson(PENDING_ACTIONS_STORAGE_KEY, actions);
}

export async function loadPendingActions() {
  return (await readJson<PendingAction[]>(PENDING_ACTIONS_STORAGE_KEY)) ?? [];
}

export async function clearPendingActions() {
  await migrateLegacyStorage();
  await AsyncStorage.removeItem(PENDING_ACTIONS_STORAGE_KEY);
}
