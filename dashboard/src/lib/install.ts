// Pure helpers for the Install page (no React, no Supabase), so they can be unit tested.

/** The web script this dashboard hands out. Keep in step with README.md (a test checks). */
export const RECAP_WEB = {
  version: '1.3.0',
  src: 'https://cdn.jsdelivr.net/gh/Scylark/recap@v1.3.0/dist/recap.min.js',
  integrity: 'sha384-8wgD4Wmlu6eME7JD9xA+I/gWbqutajBp2faL0205zSqQYR1kmkBAIkpubfFtUdh5',
};

export const PLACEHOLDER_URL = 'https://YOUR-PROJECT.supabase.co';
export const PLACEHOLDER_KEY = 'sb_publishable_YOUR_KEY';

export interface WebInstall {
  appId: string;
  /** What the person typed: "example.com", "https://www.example.com/shop", or several separated by commas. */
  site: string;
  subdomains: boolean;
  /** Path prefixes to skip, comma or newline separated. */
  skip: string;
  record: boolean;
  canvas: boolean;
  consent: boolean;
}

/** A short, stable app id: lowercase letters, digits and dashes. */
export function cleanAppId(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Hostnames from what was typed, without scheme, path, port or a leading "www.". */
export function siteHosts(site: string): string[] {
  const out: string[] = [];
  for (const part of site.split(/[\s,]+/)) {
    const raw = part.trim();
    if (!raw) continue;
    let host: string;
    try {
      host = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
    } catch {
      continue;
    }
    host = host.toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
    if (host && /^[a-z0-9.-]+$/.test(host) && !out.includes(host)) out.push(host);
  }
  return out;
}

/** The data-hosts value: each site plus www, or plus every subdomain. */
export function hostsValue(site: string, subdomains: boolean): string {
  return siteHosts(site)
    .flatMap((h) => (subdomains ? [h, `*.${h}`] : h === 'localhost' ? [h] : [h, `www.${h}`]))
    .join(',');
}

/** Path prefixes, each starting with "/". */
export function skipValue(skip: string): string {
  return skip
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('/') ? p : `/${p}`))
    .join(',');
}

const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The script tag to paste into every page's <head>. */
export function scriptTag(o: WebInstall, url: string, key: string): string {
  const lines = [
    `<script defer data-recap`,
    `  src="${RECAP_WEB.src}"`,
    `  integrity="${RECAP_WEB.integrity}" crossorigin="anonymous"`,
    `  data-app-id="${attr(cleanAppId(o.appId) || 'my-site')}"`,
    `  data-supabase-url="${attr(url)}"`,
    `  data-supabase-key="${attr(key)}"`,
  ];
  const hosts = hostsValue(o.site, o.subdomains);
  if (hosts) lines.push(`  data-hosts="${attr(hosts)}"`);
  const skip = skipValue(o.skip);
  if (skip) lines.push(`  data-exclude-paths="${attr(skip)}"`);
  if (o.record) lines.push(`  data-recordings="true"`);
  if (o.record && o.canvas) lines.push(`  data-record-canvas="true"`);
  if (o.consent) lines.push(`  data-require-consent="true"`);
  return `${lines.join('\n')}></script>`;
}

/**
 * Why this key must not be handed out, or null when it's a public key. The dashboard should only ever
 * hold the publishable or anon key, but a mistake in its settings would otherwise be copied into sites.
 */
export function keyProblem(key: string): string | null {
  if (!key) return null;
  if (key.startsWith('sb_secret_')) return 'secret';
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))) as { role?: string };
      if (payload.role === 'service_role') return 'service_role';
    } catch {
      return null;
    }
  }
  return null;
}

/** A prompt for a coding agent (Claude Code, Cursor, Codex) that installs Recap in the open project. */
export function agentPrompt(kind: 'web' | 'app', appId: string, url: string, key: string, site = ''): string {
  const id = cleanAppId(appId) || (kind === 'web' ? 'my-site' : 'my-app');
  const common = [
    `Recap Supabase URL: ${url}`,
    `Recap publishable key (public, safe to ship): ${key}`,
    `App id: ${id}`,
  ];
  if (kind === 'app') {
    return [
      'Add Recap session analytics to this React Native / Expo app.',
      'Follow https://github.com/Scylark/recap/blob/main/AGENTS.md step by step, skipping Step 1 (the database is ready) and Step 6 (the dashboard is already deployed).',
      ...common,
      'Ask me the questions the guide marks "Ask" (consent, private screens, recordings) before turning anything on in production.',
    ].join('\n');
  }
  const hosts = hostsValue(site, false);
  return [
    'Add Recap session analytics to this website.',
    'Follow the "Websites and web apps" section of https://github.com/Scylark/recap/blob/main/AGENTS.md. Use the script tag (or the recap-ux package if this project has a bundler), and don\'t write a wrapper around it.',
    ...common,
    ...(hosts ? [`Production hostnames: ${hosts}`] : ['Ask me for the production hostnames.']),
    'Ask me which pages or parts of pages show personal details, mark them with data-recap-private, and wire Recap.optOut() to a settings switch.',
  ].join('\n');
}
