import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { trackDriverEvent } from './telemetry';

describe('trackDriverEvent', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_DRIVER_TELEMETRY_ENDPOINT;
    jest.restoreAllMocks();
  });

  it('does nothing when telemetry endpoint is not configured', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    await trackDriverEvent('auth_login_attempt', { email: 'driver@test.com' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts event payload to configured telemetry endpoint', async () => {
    process.env.EXPO_PUBLIC_DRIVER_TELEMETRY_ENDPOINT = 'https://example.com/telemetry';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await trackDriverEvent('auth_login_success', { role: 'DRIVER' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/telemetry',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      app: string;
      eventName: string;
      occurredAt: string;
      payload: Record<string, unknown>;
    };

    expect(body.app).toBe('driver-mobile');
    expect(body.eventName).toBe('auth_login_success');
    expect(body.payload).toEqual({ role: 'DRIVER' });
    expect(typeof body.occurredAt).toBe('string');
  });

  it('swallows fetch errors to keep app flow non-blocking', async () => {
    process.env.EXPO_PUBLIC_DRIVER_TELEMETRY_ENDPOINT = 'https://example.com/telemetry';
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

    await expect(trackDriverEvent('deliveries_refresh_failed', { reason: 'timeout' })).resolves.toBeUndefined();
  });
});
