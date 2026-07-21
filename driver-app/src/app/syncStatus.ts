import { localizedStrings } from '../i18n/strings';

const STALE_CACHE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface SyncStatus {
  label: string;
  isStale: boolean;
}

type SyncStrings = {
  unavailable: string;
  now: string;
  minutesAgo: (minutes: number) => string;
  hoursAgo: (hours: number) => string;
  staleDays: (days: number) => string;
};

export function getSyncStatus(
  lastSuccessfulSync: string | null,
  now = Date.now(),
  syncStrings: SyncStrings = localizedStrings.fr.sync
): SyncStatus | null {
  if (!lastSuccessfulSync) {
    return null;
  }

  const timestamp = Date.parse(lastSuccessfulSync);

  if (Number.isNaN(timestamp)) {
    return {
      label: syncStrings.unavailable,
      isStale: true,
    };
  }

  const elapsedMs = Math.max(0, now - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / (60 * 1000));

  if (elapsedMinutes < 1) {
    return {
      label: syncStrings.now,
      isStale: false,
    };
  }

  if (elapsedMinutes < 60) {
    return {
      label: syncStrings.minutesAgo(elapsedMinutes),
      isStale: false,
    };
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return {
      label: syncStrings.hoursAgo(elapsedHours),
      isStale: false,
    };
  }

  const elapsedDays = Math.floor(elapsedHours / 24);

  return {
    label: syncStrings.staleDays(elapsedDays),
    isStale: elapsedMs >= STALE_CACHE_THRESHOLD_MS,
  };
}
