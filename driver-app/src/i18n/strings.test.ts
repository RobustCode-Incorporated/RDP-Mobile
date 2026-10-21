import { describe, expect, it } from '@jest/globals';
import { localizedStrings } from './strings';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
  }

  return [prefix];
}

describe('i18n catalogs', () => {
  it('fr and en expose exactly the same keys', () => {
    expect(keyPaths(localizedStrings.en).sort()).toEqual(keyPaths(localizedStrings.fr).sort());
  });
});
