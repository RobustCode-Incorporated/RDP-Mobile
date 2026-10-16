import { api } from './client';
import type { Delivery, DeliveryHistory, Driver } from '../types/api';

/** GET /api/deliveries/me - every delivery ever assigned to the driver, newest first (contract 4.2). */
export async function fetchMyDeliveries() {
  const { data } = await api.get<Delivery[]>('/api/deliveries/me');
  return data;
}

/** GET /api/deliveries/{id} (contract 4.3). Used by the offline replay 409 rule. */
export async function fetchDelivery(deliveryId: number) {
  const { data } = await api.get<Delivery>(`/api/deliveries/${deliveryId}`);
  return data;
}

/** GET /api/deliveries/{id}/history - oldest first (contract 4.4). */
export async function fetchDeliveryHistory(deliveryId: number) {
  const { data } = await api.get<DeliveryHistory[]>(`/api/deliveries/${deliveryId}/history`);
  return data;
}

/* Driver actions (contract 4.9). Not idempotent: replay rules live in app/offlineQueue.ts. */

export async function pickupDelivery(deliveryId: number) {
  const { data } = await api.put<Delivery>(`/api/deliveries/${deliveryId}/pickup`);
  return data;
}

export async function startDelivery(deliveryId: number) {
  const { data } = await api.put<Delivery>(`/api/deliveries/${deliveryId}/start`);
  return data;
}

export async function completeDelivery(deliveryId: number) {
  const { data } = await api.put<Delivery>(`/api/deliveries/${deliveryId}/complete`);
  return data;
}

export async function failDelivery(deliveryId: number, reason: string) {
  const { data } = await api.put<Delivery>(`/api/deliveries/${deliveryId}/fail`, { reason });
  return data;
}

/** PATCH /api/drivers/me/location (contract 5). Does not change availability. */
export async function updateMyLocation(latitude: number, longitude: number) {
  const { data } = await api.patch<Driver>('/api/drivers/me/location', {
    latitude,
    longitude,
  });
  return data;
}
