// The README is what coding agents copy from, so check the parts that matter for privacy.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('README', () => {
  it('names Expo Router screens by route pattern, not by address (which can hold ids)', () => {
    expect(readme).not.toMatch(/useRecapScreen\(\s*usePathname\(\)\s*\)/);
    expect(readme).toMatch(/useSegments\(\)/);
    expect(readme).toMatch(/\[id\]/);
  });

  it("doesn't promise that filled-in fields are hidden from recordings", () => {
    expect(readme).not.toMatch(/never records typed text/i);
    expect(readme).toMatch(/keyboard closes[^.]*RecapPrivate/s);
  });
});
