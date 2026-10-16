import { describe, expect, it } from '@jest/globals';
import { hostedBaseUrl, resolveApiBaseUrl } from './client';

const localUrl = 'http://10.0.2.2:8080';

describe('resolveApiBaseUrl', () => {
  it('uses EXPO_PUBLIC_API_BASE_URL when provided, in dev and release', () => {
    expect(resolveApiBaseUrl({ envUrl: 'https://api.example.test', isDev: true, localUrl, hostedUrl: hostedBaseUrl }))
      .toBe('https://api.example.test');
    expect(resolveApiBaseUrl({ envUrl: ' https://api.example.test ', isDev: false, localUrl, hostedUrl: hostedBaseUrl }))
      .toBe('https://api.example.test');
  });

  it('falls back to the local backend in development', () => {
    expect(resolveApiBaseUrl({ envUrl: undefined, isDev: true, localUrl, hostedUrl: hostedBaseUrl })).toBe(localUrl);
    expect(resolveApiBaseUrl({ envUrl: '  ', isDev: true, localUrl, hostedUrl: hostedBaseUrl })).toBe(localUrl);
  });

  it('falls back to the hosted backend in release builds', () => {
    expect(resolveApiBaseUrl({ envUrl: undefined, isDev: false, localUrl, hostedUrl: hostedBaseUrl })).toBe(hostedBaseUrl);
  });
});

import { AxiosError, AxiosHeaders } from 'axios';
import { getApiErrorMessage, getApiErrorStatus, isRetryableError, parseApiError } from './client';

function buildAxiosError(status: number | null, data?: unknown, url = '/api/deliveries/1/pickup') {
  const config = { url, headers: new AxiosHeaders() };
  const response = status === null ? undefined : {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  };

  return new AxiosError('Request failed', status === null ? 'ERR_NETWORK' : 'ERR_BAD_RESPONSE', config, {}, response as never);
}

describe('contract error body parsing', () => {
  it('parses { status, error, message, fieldErrors }', () => {
    const error = buildAxiosError(400, {
      status: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      timestamp: '2026-10-16T11:31:29.320594Z',
      path: '/api/deliveries/1/fail',
      fieldErrors: { reason: 'Reason is required' },
    });

    expect(parseApiError(error)).toEqual(expect.objectContaining({
      status: 400,
      message: 'Validation failed',
      fieldErrors: { reason: 'Reason is required' },
    }));
    expect(getApiErrorMessage(error)).toBe('Reason is required');
    expect(getApiErrorStatus(error)).toBe(400);
  });

  it('uses the message when there are no fieldErrors', () => {
    const error = buildAxiosError(409, {
      status: 409,
      error: 'Conflict',
      message: 'Cannot change delivery status from PICKED_UP to PICKED_UP',
      timestamp: 'x',
      path: '/api/deliveries/1/pickup',
    });

    expect(getApiErrorMessage(error)).toBe('Cannot change delivery status from PICKED_UP to PICKED_UP');
  });

  it('returns null for network errors and treats network/5xx as retryable', () => {
    expect(parseApiError(buildAxiosError(null))).toBeNull();
    expect(isRetryableError(buildAxiosError(null))).toBe(true);
    expect(isRetryableError(buildAxiosError(503, 'Service Unavailable'))).toBe(true);
    expect(isRetryableError(buildAxiosError(409, { message: 'x' }))).toBe(false);
  });
});
