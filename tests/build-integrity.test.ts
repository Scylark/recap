// @vitest-environment node
// recap.min.js carries the sha384 hash of the recap-rrweb.min.js it was built with.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UserConfig, UserConfigFnObject } from 'vite';
import viteConfig from '../vite.config';
import { RRWEB_DIST, integrityOf } from '../scripts/rrweb-integrity.mjs';

const configFor = (mode: string) =>
  (viteConfig as unknown as UserConfigFnObject)({ command: 'build', mode, isSsrBuild: false, isPreview: false }) as UserConfig;

describe('the recorder integrity hash', () => {
  it('is the sha384 of the file, as browsers check it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'recap-sri-')), 'recap-rrweb.min.js');
    writeFileSync(file, 'abc');
    expect(integrityOf(file)).toBe('sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn');
    expect(() => integrityOf(join(tmpdir(), 'no-such-dir', 'recap-rrweb.min.js'))).toThrow(/build it first/);
  });

  it.skipIf(!existsSync(RRWEB_DIST))('is put into the script-tag build, from dist/recap-rrweb.min.js', () => {
    const expected = `sha384-${createHash('sha384').update(readFileSync(RRWEB_DIST)).digest('base64')}`;
    expect(configFor('script-tag').define).toEqual({ __RECAP_RRWEB_INTEGRITY__: JSON.stringify(expected) });
    expect(configFor('production').define).toBeUndefined();
  });

  it('npm run build makes recap-rrweb.min.js before recap.min.js', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { scripts: { build: string } };
    const steps = pkg.scripts.build.split('&&').map((s) => s.trim());
    expect(steps.indexOf('vite build --mode rrweb')).toBeGreaterThan(-1);
    expect(steps.indexOf('vite build --mode rrweb')).toBeLessThan(steps.indexOf('vite build --mode script-tag'));
  });
});
