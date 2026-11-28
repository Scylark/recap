import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECAP_WEB, agentPrompt, cleanAppId, hostsValue, keyProblem, scriptTag, siteHosts, skipValue } from '../src/lib/install';

const base = { appId: 'My Shop!', site: 'https://www.example.com/shop', subdomains: false, skip: 'account, /admin', record: true, canvas: false, consent: false };

describe('install page helpers', () => {
  it('hands out the same script and hash as the README', () => {
    // Run from dashboard/ (npm test) or from the repo root (the root vitest picks these up too).
    const path = [join(process.cwd(), '..', 'README.md'), join(process.cwd(), 'README.md')].find(
      (p) => existsSync(p) && readFileSync(p, 'utf8').includes('recap.min.js'),
    );
    expect(path).toBeDefined();
    const readme = readFileSync(path!, 'utf8');
    expect(readme).toContain(`src="${RECAP_WEB.src}"`);
    expect(readme).toContain(`integrity="${RECAP_WEB.integrity}"`);
    expect(RECAP_WEB.src).toContain(`@v${RECAP_WEB.version}/`);
  });

  it('cleans names and addresses', () => {
    expect(cleanAppId('My Shop!')).toBe('my-shop');
    expect(siteHosts('https://www.example.com/shop, shop.example.org:8080 , example.com')).toEqual(['example.com', 'shop.example.org']);
    expect(hostsValue('example.com', false)).toBe('example.com,www.example.com');
    expect(hostsValue('example.com', true)).toBe('example.com,*.example.com');
    expect(hostsValue('', false)).toBe('');
    expect(skipValue('account, /admin\n/orders')).toBe('/account,/admin,/orders');
  });

  it('builds a working script tag', () => {
    const tag = scriptTag(base, 'https://abc.supabase.co', 'sb_publishable_x');
    expect(tag).toContain('data-app-id="my-shop"');
    expect(tag).toContain('data-supabase-url="https://abc.supabase.co"');
    expect(tag).toContain('data-supabase-key="sb_publishable_x"');
    expect(tag).toContain('data-hosts="example.com,www.example.com"');
    expect(tag).toContain('data-exclude-paths="/account,/admin"');
    expect(tag).toContain('data-recordings="true"');
    expect(tag).not.toContain('data-record-canvas');
    expect(tag).not.toContain('data-require-consent');
    expect(tag.startsWith('<script defer data-recap')).toBe(true);
    expect(tag.endsWith('></script>')).toBe(true);
    const all = scriptTag({ ...base, canvas: true, consent: true, record: true }, 'u', 'k');
    expect(all).toContain('data-record-canvas="true"');
    expect(all).toContain('data-require-consent="true"');
    expect(scriptTag({ ...base, record: false, canvas: true }, 'u', 'k')).not.toMatch(/data-record/);
  });

  it('escapes attribute values', () => {
    expect(scriptTag({ ...base, skip: '/a"b' }, 'u', 'k')).toContain('data-exclude-paths="/a&quot;b"');
  });

  it('refuses to hand out a secret key', () => {
    expect(keyProblem('sb_secret_abc')).toBe('secret');
    const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;
    expect(keyProblem(jwt('service_role'))).toBe('service_role');
    expect(keyProblem(jwt('anon'))).toBeNull();
    expect(keyProblem('sb_publishable_abc')).toBeNull();
    expect(keyProblem('')).toBeNull();
  });

  it('writes agent prompts with the values filled in', () => {
    const web = agentPrompt('web', 'Shop', 'https://abc.supabase.co', 'sb_publishable_x', 'example.com');
    expect(web).toContain('App id: shop');
    expect(web).toContain('Production hostnames: example.com,www.example.com');
    expect(web).toContain('https://abc.supabase.co');
    const app = agentPrompt('app', '', 'u', 'k');
    expect(app).toContain('App id: my-app');
    expect(app).toContain('AGENTS.md');
  });
});
