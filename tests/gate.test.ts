import { afterEach, describe, expect, it, vi } from 'vitest';
import { gpcOn, hostAllowed, inFrame, pathExcluded, readTabSwitch, secretKeyKind } from '../src/gate';

/** A JWT-shaped key with this payload (Supabase's legacy anon and service_role keys look like this). */
function jwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`;
}

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('hosts', () => {
  it('matches hostnames exactly, ignoring case and a trailing dot', () => {
    expect(hostAllowed('example.com', ['example.com'])).toBe(true);
    expect(hostAllowed('Example.COM', ['example.com'])).toBe(true);
    expect(hostAllowed('example.com.', ['example.com'])).toBe(true);
    expect(hostAllowed('www.example.com', ['example.com'])).toBe(false);
    expect(hostAllowed('example.com.evil.net', ['example.com'])).toBe(false);
    expect(hostAllowed('localhost', ['example.com'])).toBe(false);
  });

  it('matches every subdomain with *.example.com, but not the bare domain', () => {
    expect(hostAllowed('www.example.com', ['*.example.com'])).toBe(true);
    expect(hostAllowed('a.b.example.com', ['*.example.com'])).toBe(true);
    expect(hostAllowed('example.com', ['*.example.com'])).toBe(false);
    expect(hostAllowed('notexample.com', ['*.example.com'])).toBe(false);
    expect(hostAllowed('example.com', ['example.com', '*.example.com'])).toBe(true);
  });

  it('accepts entries pasted as addresses or with a port', () => {
    expect(hostAllowed('example.com', ['https://example.com/'])).toBe(true);
    expect(hostAllowed('example.com', ['example.com:443'])).toBe(true);
  });

  it('an empty list matches nothing', () => {
    expect(hostAllowed('example.com', [])).toBe(false);
    expect(hostAllowed('example.com', ['', '  '])).toBe(false);
  });
});

describe('excludePaths', () => {
  it('treats strings as path prefixes', () => {
    expect(pathExcluded('/admin', ['/admin'])).toBe(true);
    expect(pathExcluded('/admin/users', ['/admin'])).toBe(true);
    expect(pathExcluded('/admin.html', ['/admin'])).toBe(true);
    expect(pathExcluded('/coach-rider.html', ['/account', '/coach-rider'])).toBe(true);
    expect(pathExcluded('/', ['/admin'])).toBe(false);
    expect(pathExcluded('/blog/admin', ['/admin'])).toBe(false);
  });

  it('adds a missing leading slash and ignores blanks', () => {
    expect(pathExcluded('/admin/x', ['admin'])).toBe(true);
    expect(pathExcluded('/anything', [''])).toBe(false);
  });

  it('tests RegExps against the path, also global ones', () => {
    const re = /^\/orders\/\d+$/g;
    expect(pathExcluded('/orders/42', [re])).toBe(true);
    expect(pathExcluded('/orders/42', [re])).toBe(true); // lastIndex is reset
    expect(pathExcluded('/orders', [re])).toBe(false);
  });

  it('excludes nothing when unset', () => {
    expect(pathExcluded('/admin', undefined)).toBe(false);
    expect(pathExcluded('/admin', [])).toBe(false);
  });
});

describe('?recap= test switches', () => {
  it('on, record and off are remembered for the tab', () => {
    expect(readTabSwitch('?recap=on')).toBe('on');
    expect(readTabSwitch('')).toBe('on');
    expect(readTabSwitch('?recap=record')).toBe('record');
    expect(readTabSwitch('?other=1')).toBe('record');
    expect(readTabSwitch('?recap=OFF')).toBe('off');
    expect(readTabSwitch('')).toBe('off');
    expect(sessionStorage.getItem('recap-switch')).toBe('off');
  });

  it('auto clears the switch', () => {
    readTabSwitch('?recap=off');
    expect(readTabSwitch('?recap=auto')).toBeNull();
    expect(readTabSwitch('')).toBeNull();
    expect(sessionStorage.getItem('recap-switch')).toBeNull();
  });

  it('ignores other values', () => {
    expect(readTabSwitch('?recap=yes')).toBeNull();
    expect(readTabSwitch('?recaptcha=on')).toBeNull();
  });
});

describe('secret keys', () => {
  it('spots a service_role JWT and an sb_secret_ key', () => {
    expect(secretKeyKind(jwt({ iss: 'supabase', role: 'service_role' }))).toBe('service_role');
    expect(secretKeyKind('sb_secret_abc123')).toBe('sb_secret');
    expect(secretKeyKind('  sb_secret_abc123 ')).toBe('sb_secret');
  });

  it('lets public keys through', () => {
    expect(secretKeyKind(jwt({ iss: 'supabase', role: 'anon' }))).toBeNull();
    expect(secretKeyKind('sb_publishable_abc123')).toBeNull();
    expect(secretKeyKind('eyJ.not-base64!.x')).toBeNull();
    expect(secretKeyKind(undefined)).toBeNull();
  });
});

describe('frames and Global Privacy Control', () => {
  it('knows when the page is framed', () => {
    expect(inFrame()).toBe(false);
    vi.stubGlobal('top', {});
    expect(inFrame()).toBe(true);
  });

  it('reads navigator.globalPrivacyControl', () => {
    expect(gpcOn()).toBe(false);
    vi.stubGlobal('navigator', { ...navigator, globalPrivacyControl: true });
    expect(gpcOn()).toBe(true);
  });
});
