// The live-site gate: the checks that decide whether Recap runs on a page at all. Recap.init()
// puts them together (src/index.ts); this file only holds the pieces, so each can be tested alone.

/** Why Recap is or isn't running on this page. See Recap.status(). */
export type RecapStatusReason =
  /** Started and capturing. */
  | 'running'
  /** Recap.init() hasn't been called yet. */
  | 'not-started'
  /** `?recap=off` was opened in this tab. `?recap=auto` clears it. */
  | 'switched-off'
  /** The page is inside an iframe and Recap sends to a dashboard. `allowInFrames: true` allows it. */
  | 'in-frame'
  /** The Supabase key is a secret key (service_role or sb_secret_…), so nothing is sent. */
  | 'secret-key'
  /** `hosts` is set and this page's hostname isn't in it. `?recap=on` runs here anyway. */
  | 'host-not-listed'
  /** This page's path matches `excludePaths`. */
  | 'excluded-path'
  /** The browser sends Global Privacy Control and `respectGPC` is on (the default when sending). */
  | 'gpc'
  /** The visitor called Recap.optOut() in this browser. */
  | 'opted-out'
  /** `requireConsent` is on and Recap.optIn() hasn't been called. */
  | 'consent-needed';

export interface RecapStatus {
  /** Recap is capturing on this page. */
  running: boolean;
  /** This tab's page is being recorded for replay (rrweb is loaded and recording). */
  recording: boolean;
  /** Why: `'running'`, or what stops it, e.g. `'host-not-listed'`. */
  reason: RecapStatusReason;
}

// --- Test switches: ?recap=on | record | off | auto ---

/**
 * A tester's switch for this tab, from `?recap=` in the address and remembered in sessionStorage:
 * `'on'` runs here whatever `hosts` says, with debug logging; `'record'` is the same and also
 * records this tab's page; `'off'` stops Recap in this tab; `?recap=auto` clears the switch.
 */
export type TabSwitch = 'on' | 'record' | 'off' | null;

const KEY_SWITCH = 'recap-switch';

function isSwitch(v: unknown): v is 'on' | 'record' | 'off' {
  return v === 'on' || v === 'record' || v === 'off';
}

/** Read `?recap=` from a query string, remember it for the tab, and return the tab's switch. */
export function readTabSwitch(search: string): TabSwitch {
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(search).get('recap');
  } catch {
    asked = null;
  }
  const v = asked?.trim().toLowerCase();
  if (isSwitch(v)) {
    try {
      sessionStorage.setItem(KEY_SWITCH, v);
    } catch {
      // storage blocked: the switch holds for this page only
    }
    return v;
  }
  if (v === 'auto') {
    try {
      sessionStorage.removeItem(KEY_SWITCH);
    } catch {
      // nothing was kept
    }
    return null;
  }
  try {
    const saved = sessionStorage.getItem(KEY_SWITCH);
    return isSwitch(saved) ? saved : null;
  } catch {
    return null;
  }
}

// --- hosts ---

/** A `hosts` entry as a bare lower-case hostname, also when written as an address ("https://x.com/"). */
function hostOf(entry: string): string {
  let h = entry.trim().toLowerCase();
  if (h.includes('://')) {
    try {
      h = new URL(h).hostname;
    } catch {
      // keep it as written
    }
  }
  return h.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
}

/**
 * Whether a hostname is in a `hosts` list. Entries match exactly (`example.com`), or `*.example.com`
 * matches every subdomain of example.com (not example.com itself: list both for both). An empty
 * list matches nothing.
 */
export function hostAllowed(hostname: string, hosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return hosts.some((entry) => {
    if (typeof entry !== 'string') return false;
    const h = hostOf(entry);
    if (!h) return false;
    if (h.startsWith('*.')) return host.endsWith(h.slice(1)) && host.length > h.length - 1;
    return host === h;
  });
}

// --- excludePaths ---

/**
 * Whether a page path matches `excludePaths`. A string is a path prefix (`'/admin'` covers
 * `/admin`, `/admin/users` and `/admin.html`); a RegExp is tested against the path.
 */
export function pathExcluded(path: string, excludes: ReadonlyArray<string | RegExp> | undefined): boolean {
  if (!excludes || excludes.length === 0) return false;
  return excludes.some((x) => {
    if (x instanceof RegExp) {
      x.lastIndex = 0;
      return x.test(path);
    }
    if (typeof x !== 'string') return false;
    const prefix = x.trim();
    if (!prefix) return false;
    return path.startsWith(prefix.startsWith('/') ? prefix : `/${prefix}`);
  });
}

// --- Frames and Global Privacy Control ---

/** Whether this page is inside an iframe (a cross-origin parent counts too). */
export function inFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Whether the browser sends Global Privacy Control (navigator.globalPrivacyControl). */
export function gpcOn(): boolean {
  try {
    return typeof navigator !== 'undefined' && (navigator as { globalPrivacyControl?: unknown }).globalPrivacyControl === true;
  } catch {
    return false;
  }
}

// --- Secret keys ---

/**
 * Whether a Supabase key is a secret one that must never be in a web page: a JWT whose payload
 * role is `service_role`, or a new-style `sb_secret_…` key. Returns which, or null for a public
 * (anon or publishable) key.
 */
export function secretKeyKind(key: unknown): 'service_role' | 'sb_secret' | null {
  if (typeof key !== 'string') return null;
  const k = key.trim();
  if (k.startsWith('sb_secret_')) return 'sb_secret';
  const parts = k.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { role?: unknown };
    return payload && payload.role === 'service_role' ? 'service_role' : null;
  } catch {
    return null;
  }
}

/** The console message for a refused secret key. */
export function secretKeyMessage(kind: 'service_role' | 'sb_secret'): string {
  const name = kind === 'service_role' ? 'the service_role key' : 'a secret key (sb_secret_…)';
  return (
    `[Recap] Not starting: the Supabase key given is ${name}. It gives full access to your database ` +
    'and must never be in a web page, so Recap sends nothing. Use the anon or publishable key ' +
    '(Supabase: Project Settings, API keys), and rotate this secret key now: anyone who loaded the page can read it.'
  );
}
