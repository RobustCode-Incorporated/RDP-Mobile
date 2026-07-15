import { describe, expect, it } from '@jest/globals';

import { getSyncStatus } from './syncStatus';

describe('getSyncStatus', () => {
  it('returns null when no sync exists', () => {
    expect(getSyncStatus(null)).toBeNull();
  });

  it('marks recent syncs as fresh', () => {
    const now = new Date('2026-07-15T10:00:00.000Z').getTime();

    expect(getSyncStatus('2026-07-15T09:45:00.000Z', now)).toEqual({
      label: 'Derniere synchro il y a 15 min.',
      isStale: false,
    });
  });

  it('marks syncs older than 24 hours as stale', () => {
    const now = new Date('2026-07-15T10:00:00.000Z').getTime();

    expect(getSyncStatus('2026-07-14T09:00:00.000Z', now)).toEqual({
      label: 'Cache hors delai: derniere synchro il y a 1 j.',
      isStale: true,
    });
  });
});
