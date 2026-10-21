import { describe, expect, it } from '@jest/globals';
import { buildNavigationUrls, buildTelUrl } from './navigation';

describe('navigation helpers', () => {
  it('uses coordinates when available', () => {
    const urls = buildNavigationUrls({ latitude: 50.827, longitude: 4.364, address: 'Avenue Louise 100' });

    expect(urls.google).toContain('destination=50.827%2C4.364');
    expect(urls.waze).toContain('ll=50.827%2C4.364');
    expect(urls.apple).toContain('daddr=50.827%2C4.364');
  });

  it('falls back to the address', () => {
    const urls = buildNavigationUrls({ latitude: null, longitude: null, address: 'Avenue Louise 100, Ixelles' });

    expect(urls.google).toContain('destination=Avenue%20Louise%20100%2C%20Ixelles');
    expect(urls.waze).toContain('q=Avenue%20Louise');
  });

  it('builds tel: links', () => {
    expect(buildTelUrl('+32 470 12 34 56')).toBe('tel:+32470123456');
    expect(buildTelUrl('02/123.45.67')).toBe('tel:021234567');
    expect(buildTelUrl(null)).toBeNull();
    expect(buildTelUrl('  ')).toBeNull();
  });
});
