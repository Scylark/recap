// The README is what coding agents copy from, so check the parts that matter for privacy.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Run from sdk-react-native/ (npm test) or from the repo root, where the root vitest picks this up in
// a browser-like environment and import.meta.url isn't a file address.
const path = [join(process.cwd(), 'sdk-react-native', 'README.md'), join(process.cwd(), 'README.md')].find(
  (p) => existsSync(p) && readFileSync(p, 'utf8').includes('@recap-ux/react-native'),
);
const readme = readFileSync(path ?? 'sdk-react-native/README.md', 'utf8');

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
