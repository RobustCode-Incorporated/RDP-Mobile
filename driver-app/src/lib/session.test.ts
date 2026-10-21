import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  DELIVERY_CACHE_STORAGE_KEY,
  PENDING_ACTIONS_STORAGE_KEY,
  STORAGE_MIGRATION_FLAG_KEY,
  loadDeliveryCache,
  loadPendingActions,
  resetStorageMigrationForTests,
  saveDeliveryCache,
  savePendingActions,
  saveSession,
} from './session';

const secureGet = SecureStore.getItemAsync as jest.MockedFunction<typeof SecureStore.getItemAsync>;
const secureSet = SecureStore.setItemAsync as jest.MockedFunction<typeof SecureStore.setItemAsync>;
const secureDelete = SecureStore.deleteItemAsync as jest.MockedFunction<typeof SecureStore.deleteItemAsync>;

const legacyCache = JSON.stringify({ deliveries: [{ id: 1 }], lastSuccessfulSync: '2026-10-16T10:00:00.000Z' });
const legacyQueue = JSON.stringify([{ actionId: 'PICKUP-1-1', deliveryId: 1, actionType: 'PICKUP', state: 'queued', queuedAt: 'x', retryCount: 0 }]);

describe('storage split and legacy migration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetStorageMigrationForTests();
    await AsyncStorage.clear();
    secureGet.mockResolvedValue(null);
  });

  it('moves legacy cache and queue from SecureStore to AsyncStorage once', async () => {
    secureGet.mockImplementation(async (key: string) => {
      if (key === DELIVERY_CACHE_STORAGE_KEY) return legacyCache;
      if (key === PENDING_ACTIONS_STORAGE_KEY) return legacyQueue;
      return null;
    });

    const cache = await loadDeliveryCache();
    const queue = await loadPendingActions();

    expect(cache?.deliveries).toHaveLength(1);
    expect(queue).toHaveLength(1);
    expect(await AsyncStorage.getItem(DELIVERY_CACHE_STORAGE_KEY)).toBe(legacyCache);
    expect(await AsyncStorage.getItem(PENDING_ACTIONS_STORAGE_KEY)).toBe(legacyQueue);
    expect(await AsyncStorage.getItem(STORAGE_MIGRATION_FLAG_KEY)).toBeTruthy();
    expect(secureDelete).toHaveBeenCalledWith(DELIVERY_CACHE_STORAGE_KEY);
    expect(secureDelete).toHaveBeenCalledWith(PENDING_ACTIONS_STORAGE_KEY);

    // A second app start must not read SecureStore again.
    resetStorageMigrationForTests();
    secureGet.mockClear();
    await loadDeliveryCache();
    expect(secureGet).not.toHaveBeenCalled();
  });

  it('does not overwrite values already present in AsyncStorage', async () => {
    await AsyncStorage.setItem(PENDING_ACTIONS_STORAGE_KEY, '[]');
    secureGet.mockImplementation(async (key: string) => (key === PENDING_ACTIONS_STORAGE_KEY ? legacyQueue : null));

    expect(await loadPendingActions()).toEqual([]);
  });

  it('writes cache and queue to AsyncStorage and only the session to SecureStore', async () => {
    await saveSession({ token: 't', email: 'd@test.com', role: 'DRIVER' });
    await saveDeliveryCache({ deliveries: [], lastSuccessfulSync: 'now' });
    await savePendingActions([]);

    expect(secureSet).toHaveBeenCalledTimes(1);
    expect(secureSet.mock.calls[0][0]).toBe('driver-session');
    expect(await AsyncStorage.getItem(DELIVERY_CACHE_STORAGE_KEY)).toContain('lastSuccessfulSync');
    expect(await AsyncStorage.getItem(PENDING_ACTIONS_STORAGE_KEY)).toBe('[]');
  });

  it('drops corrupted JSON instead of crashing', async () => {
    await AsyncStorage.setItem(STORAGE_MIGRATION_FLAG_KEY, 'done');
    await AsyncStorage.setItem(DELIVERY_CACHE_STORAGE_KEY, '{not json');

    expect(await loadDeliveryCache()).toBeNull();
    expect(await AsyncStorage.getItem(DELIVERY_CACHE_STORAGE_KEY)).toBeNull();
  });
});
