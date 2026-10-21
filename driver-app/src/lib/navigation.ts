export interface NavigationTarget {
  latitude: number | null;
  longitude: number | null;
  address: string;
}

export interface NavigationUrls {
  google: string;
  waze: string;
  apple: string;
}

function hasCoordinates(target: NavigationTarget): target is NavigationTarget & { latitude: number; longitude: number } {
  return typeof target.latitude === 'number' && typeof target.longitude === 'number';
}

/**
 * Universal https links (no URL-scheme whitelisting needed). Coordinates win when the
 * contract provides them, otherwise the address string is used.
 */
export function buildNavigationUrls(target: NavigationTarget): NavigationUrls {
  if (hasCoordinates(target)) {
    const latLng = `${target.latitude},${target.longitude}`;

    return {
      google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(latLng)}&travelmode=driving`,
      waze: `https://waze.com/ul?ll=${encodeURIComponent(latLng)}&navigate=yes`,
      apple: `https://maps.apple.com/?daddr=${encodeURIComponent(latLng)}&dirflg=d`,
    };
  }

  const query = encodeURIComponent(target.address);

  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${query}&travelmode=driving`,
    waze: `https://waze.com/ul?q=${query}&navigate=yes`,
    apple: `https://maps.apple.com/?daddr=${query}&dirflg=d`,
  };
}

/** `tel:` URL keeping only digits and a leading +, e.g. "+32 470 12 34 56" -> "tel:+32470123456". */
export function buildTelUrl(phone: string | null | undefined) {
  if (!phone) {
    return null;
  }

  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, '');

  if (!digits) {
    return null;
  }

  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}
