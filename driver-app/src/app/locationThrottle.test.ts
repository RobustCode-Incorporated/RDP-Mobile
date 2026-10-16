import { describe, expect, it } from '@jest/globals';
import { distanceMeters, isHeartbeatDue, shouldPushLocation } from './locationThrottle';

const origin = { latitude: 50.8503, longitude: 4.3517, at: 0 };

describe('location throttle', () => {
  it('pushes the first fix immediately', () => {
    expect(shouldPushLocation(null, origin, 0)).toBe(true);
  });

  it('throttles small moves to one push per 15 s', () => {
    const nearby = { latitude: 50.8504, longitude: 4.3518 };
    expect(shouldPushLocation(origin, nearby, 10_000)).toBe(false);
    expect(shouldPushLocation(origin, nearby, 15_000)).toBe(true);
  });

  it('pushes earlier on significant movement but never more than every 5 s', () => {
    const far = { latitude: 50.853, longitude: 4.3517 }; // ~300 m north
    expect(distanceMeters(origin, far)).toBeGreaterThan(150);
    expect(shouldPushLocation(origin, far, 3_000)).toBe(false);
    expect(shouldPushLocation(origin, far, 6_000)).toBe(true);
  });

  it('requests a heartbeat after 30 s without push', () => {
    expect(isHeartbeatDue(null, 0)).toBe(true);
    expect(isHeartbeatDue(origin, 29_000)).toBe(false);
    expect(isHeartbeatDue(origin, 30_000)).toBe(true);
  });
});
