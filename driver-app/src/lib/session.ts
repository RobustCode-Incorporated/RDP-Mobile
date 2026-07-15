import * as SecureStore from 'expo-secure-store';
import type { CachedDeliveriesState, PendingAction, StoredSession } from '../types/api';

const SESSION_STORAGE_KEY = 'driver-session';
const DELIVERY_CACHE_STORAGE_KEY = 'driver-deliveries-cache';
const PENDING_ACTIONS_STORAGE_KEY = 'driver-pending-actions';

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
  await SecureStore.setItemAsync(DELIVERY_CACHE_STORAGE_KEY, JSON.stringify(cache));
}

export async function loadDeliveryCache() {
  const rawValue = await SecureStore.getItemAsync(DELIVERY_CACHE_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  return JSON.parse(rawValue) as CachedDeliveriesState;
}

export async function clearDeliveryCache() {
  await SecureStore.deleteItemAsync(DELIVERY_CACHE_STORAGE_KEY);
}

export async function savePendingActions(actions: PendingAction[]) {
  await SecureStore.setItemAsync(PENDING_ACTIONS_STORAGE_KEY, JSON.stringify(actions));
}

export async function loadPendingActions() {
  const rawValue = await SecureStore.getItemAsync(PENDING_ACTIONS_STORAGE_KEY);

  if (!rawValue) {
    return [];
  }

  return JSON.parse(rawValue) as PendingAction[];
}

export async function clearPendingActions() {
  await SecureStore.deleteItemAsync(PENDING_ACTIONS_STORAGE_KEY);
}