/**
 * Live location policy (contract 9.1): PATCH /api/drivers/me/location every 15-30 s while
 * a delivery is ASSIGNED | PICKED_UP | IN_TRANSIT, and on significant movement.
 * Foreground only for the pilot; background tracking is a session-3 item (see README).
 */
export const LOCATION_PUSH_MIN_INTERVAL_MS = 15_000;
export const LOCATION_HEARTBEAT_INTERVAL_MS = 30_000;
export const SIGNIFICANT_MOVE_METERS = 150;
export const SIGNIFICANT_MOVE_MIN_INTERVAL_MS = 5_000;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface LocationPush extends Coordinates {
  at: number;
}

export function distanceMeters(start: Coordinates, end: Coordinates) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => value * (Math.PI / 180);
  const deltaLatitude = toRadians(end.latitude - start.latitude);
  const deltaLongitude = toRadians(end.longitude - start.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(toRadians(start.latitude)) * Math.cos(toRadians(end.latitude)) * Math.sin(deltaLongitude / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Decides whether a new GPS fix should be sent to the server. */
export function shouldPushLocation(lastPush: LocationPush | null, next: Coordinates, now: number) {
  if (!lastPush) {
    return true;
  }

  const elapsed = now - lastPush.at;

  if (elapsed < SIGNIFICANT_MOVE_MIN_INTERVAL_MS) {
    return false;
  }

  if (elapsed >= LOCATION_PUSH_MIN_INTERVAL_MS) {
    return true;
  }

  return distanceMeters(lastPush, next) >= SIGNIFICANT_MOVE_METERS;
}

/** Heartbeat for a stationary driver (iOS emits no fix without movement). */
export function isHeartbeatDue(lastPush: LocationPush | null, now: number) {
  return !lastPush || now - lastPush.at >= LOCATION_HEARTBEAT_INTERVAL_MS;
}
