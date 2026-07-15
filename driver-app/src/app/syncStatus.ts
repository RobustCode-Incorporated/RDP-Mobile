const STALE_CACHE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface SyncStatus {
  label: string;
  isStale: boolean;
}

export function getSyncStatus(lastSuccessfulSync: string | null, now = Date.now()): SyncStatus | null {
  if (!lastSuccessfulSync) {
    return null;
  }

  const timestamp = Date.parse(lastSuccessfulSync);

  if (Number.isNaN(timestamp)) {
    return {
      label: 'Derniere synchro indisponible.',
      isStale: true,
    };
  }

  const elapsedMs = Math.max(0, now - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / (60 * 1000));

  if (elapsedMinutes < 1) {
    return {
      label: 'Synchro a l instant.',
      isStale: false,
    };
  }

  if (elapsedMinutes < 60) {
    return {
      label: `Derniere synchro il y a ${elapsedMinutes} min.`,
      isStale: false,
    };
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return {
      label: `Derniere synchro il y a ${elapsedHours} h.`,
      isStale: false,
    };
  }

  const elapsedDays = Math.floor(elapsedHours / 24);

  return {
    label: `Cache hors delai: derniere synchro il y a ${elapsedDays} j.`,
    isStale: elapsedMs >= STALE_CACHE_THRESHOLD_MS,
  };
}
