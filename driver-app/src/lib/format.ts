/** Pilot zone (contract 1: display timestamps in Europe/Brussels). */
export const DISPLAY_TIME_ZONE = 'Europe/Brussels';

const eurFormatter = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

/** EUR amounts are always formatted fr-BE (contract 1: "Money"), e.g. "34,00 €". */
export function formatEur(amount: number | null | undefined) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '';
  }

  return eurFormatter.format(amount);
}

function safeFormat(iso: string, locale: string, options: Intl.DateTimeFormatOptions) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  try {
    return date.toLocaleString(locale, { ...options, timeZone: DISPLAY_TIME_ZONE });
  } catch {
    return date.toLocaleString(locale, options);
  }
}

export function formatTime(iso: string | null | undefined, locale: 'fr' | 'en' = 'fr') {
  if (!iso) {
    return '';
  }

  return safeFormat(iso, locale === 'en' ? 'en-GB' : 'fr-BE', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string | null | undefined, locale: 'fr' | 'en' = 'fr') {
  if (!iso) {
    return '';
  }

  return safeFormat(iso, locale === 'en' ? 'en-GB' : 'fr-BE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Calendar day (YYYY-MM-DD) in the pilot time zone. */
export function localDayKey(value: string | number | Date) {
  const date = new Date(value);

  try {
    return date.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIME_ZONE });
  } catch {
    return date.toLocaleDateString('en-CA');
  }
}
