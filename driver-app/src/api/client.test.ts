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
