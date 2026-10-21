import { describe, expect, it } from '@jest/globals';
import { groupDeliveriesForList } from './deliveryGrouping';
import { formatEur } from '../lib/format';
import { buildDelivery } from '../test/fixtures';

describe('groupDeliveriesForList', () => {
  const now = new Date('2026-10-16T15:00:00.000Z').getTime();

  it('puts active deliveries first in ASSIGNED -> PICKED_UP -> IN_TRANSIT order', () => {
    const grouped = groupDeliveriesForList([
      buildDelivery({ id: 1, status: 'IN_TRANSIT' }),
      buildDelivery({ id: 2, status: 'ASSIGNED', assignedAt: '2026-10-16T10:00:00.000Z' }),
      buildDelivery({ id: 3, status: 'PICKED_UP' }),
      buildDelivery({ id: 4, status: 'ASSIGNED', assignedAt: '2026-10-16T09:00:00.000Z' }),
    ], now);

    expect(grouped.active.map((delivery) => delivery.id)).toEqual([4, 2, 3, 1]);
  });

  it('keeps only today finished/failed deliveries in the finished group', () => {
    const grouped = groupDeliveriesForList([
      buildDelivery({ id: 1, status: 'DELIVERED', deliveredAt: '2026-10-16T11:00:00.000Z' }),
      buildDelivery({ id: 2, status: 'FAILED', failedAt: '2026-10-16T12:00:00.000Z', failureReason: 'Client absent' }),
      buildDelivery({ id: 3, status: 'DELIVERED', deliveredAt: '2026-10-14T11:00:00.000Z' }),
    ], now);

    expect(grouped.finishedToday.map((delivery) => delivery.id)).toEqual([2, 1]);
    expect(grouped.active).toEqual([]);
  });
});

describe('formatEur', () => {
  it('formats EUR amounts the fr-BE way', () => {
    expect(formatEur(34)).toMatch(/^34,00\s€$/);
    expect(formatEur(1234.5)).toMatch(/^1[\s. ]?234,50\s€$/);
    expect(formatEur(null)).toBe('');
  });
});
