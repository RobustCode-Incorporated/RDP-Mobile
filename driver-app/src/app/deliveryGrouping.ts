import type { Delivery, DeliveryStatus } from '../types/api';
import { isTerminalDelivery } from '../types/api';
import { localDayKey } from '../lib/format';

/** Display order of active deliveries in the driver list. */
export const ACTIVE_STATUS_ORDER: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'];

export function getTerminalTimestamp(delivery: Delivery) {
  return delivery.deliveredAt ?? delivery.failedAt ?? delivery.cancelledAt ?? delivery.updatedAt ?? delivery.createdAt;
}

export interface GroupedDeliveries {
  active: Delivery[];
  finishedToday: Delivery[];
}

/**
 * Active deliveries first (ASSIGNED -> PICKED_UP -> IN_TRANSIT, oldest assignment first);
 * DELIVERED / FAILED / CANCELLED of today in a separate (collapsed) group; older ones hidden.
 */
export function groupDeliveriesForList(deliveries: Delivery[], now = Date.now()): GroupedDeliveries {
  const today = localDayKey(now);
  const statusRank = (status: DeliveryStatus) => {
    const index = ACTIVE_STATUS_ORDER.indexOf(status);
    return index === -1 ? ACTIVE_STATUS_ORDER.length : index;
  };
  const sortKey = (delivery: Delivery) => Date.parse(delivery.assignedAt ?? delivery.createdAt) || 0;

  const active = deliveries
    .filter((delivery) => !isTerminalDelivery(delivery))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || sortKey(a) - sortKey(b));

  const finishedToday = deliveries
    .filter((delivery) => isTerminalDelivery(delivery) && localDayKey(getTerminalTimestamp(delivery)) === today)
    .sort((a, b) => Date.parse(getTerminalTimestamp(b)) - Date.parse(getTerminalTimestamp(a)));

  return { active, finishedToday };
}
