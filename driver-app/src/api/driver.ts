import { api } from './client';
import type { DriverDeliveryDto } from '../types/api';

export async function fetchMyDeliveries() {
  const { data } = await api.get<DriverDeliveryDto[]>('/api/deliveries/me');
  return data;
}

export async function pickupDelivery(deliveryId: number) {
  const { data } = await api.put<DriverDeliveryDto>(`/api/deliveries/${deliveryId}/pickup`);
  return data;
}

export async function startDelivery(deliveryId: number) {
  const { data } = await api.put<DriverDeliveryDto>(`/api/deliveries/${deliveryId}/start`);
  return data;
}

export async function completeDelivery(deliveryId: number) {
  const { data } = await api.put<DriverDeliveryDto>(`/api/deliveries/${deliveryId}/complete`);
  return data;
}

export async function failDelivery(deliveryId: number, reason: string) {
  const { data } = await api.put<DriverDeliveryDto>(`/api/deliveries/${deliveryId}/fail`, { reason });
  return data;
}