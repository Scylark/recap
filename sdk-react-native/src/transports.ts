import type { FramesPayload, IngestBatch, ScreenshotPayload, Transport } from './types';

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

async function postJSON(url: string, headers: Record<string, string>, body: unknown): Promise<void> {
  const fetchFn = (globalThis as unknown as { fetch: FetchLike }).fetch;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Recap: upload failed with HTTP ${res.status}`);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes base64 or base64url to a byte string. Hermes before React Native 0.74 has no atob. */
function decodeBase64(s: string): string | null {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let out = '';
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = B64.indexOf(ch);
    if (i < 0) return null;
    value = (value << 6) | i;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  return out;
}

/**
 * Whether a Supabase key is a secret one that must never ship in an app: a JWT whose payload role
 * is `service_role`, or a new-style `sb_secret_…` key. Returns which, or null for a public (anon or
 * publishable) key. The same check as the web library's.
 */
export function secretKeyKind(key: unknown): 'service_role' | 'sb_secret' | null {
  if (typeof key !== 'string') return null;
  const k = key.trim().replace(/^Bearer\s+/i, '');
  if (k.startsWith('sb_secret_')) return 'sb_secret';
  const parts = k.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = decodeBase64(parts[1]);
    if (!json) return null;
    const payload = JSON.parse(json) as { role?: unknown } | null;
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
    'and must never be in an app, so Recap records and sends nothing. Use the anon or publishable key ' +
    '(Supabase: Project Settings, API keys). If a build with this key has left your machine, rotate the key now: ' +
    'anyone with the app can read it.'
  );
}

/**
 * Sends batches to the `recap_ingest` function created by supabase/migrations.
 * Uses the project's public anon key, which can only call that function: it cannot read any data.
 * A service_role or sb_secret_ key is refused: nothing is sent, and an error is logged.
 */
export function supabaseTransport(opts: { url: string; anonKey: string }): Transport {
  const secret = secretKeyKind(opts.anonKey);
  if (secret) {
    console.error(secretKeyMessage(secret));
    const refuse = () => Promise.reject(new Error('Recap: refusing to send with a secret Supabase key'));
    return { send: refuse, sendScreenshot: refuse, sendFrames: refuse };
  }
  const base = opts.url.replace(/\/+$/, '');
  // Legacy anon keys are JWTs and go in both headers. Newer publishable keys (sb_publishable_...)
  // go in the apikey header only.
  const headers: Record<string, string> = opts.anonKey.startsWith('eyJ')
    ? { apikey: opts.anonKey, Authorization: `Bearer ${opts.anonKey}` }
    : { apikey: opts.anonKey };
  return {
    send: (batch: IngestBatch) => postJSON(`${base}/rest/v1/rpc/recap_ingest`, headers, { payload: batch }),
    sendScreenshot: (shot: ScreenshotPayload) =>
      postJSON(`${base}/rest/v1/rpc/recap_screenshot`, headers, { payload: shot }),
    sendFrames: (frames: FramesPayload) => postJSON(`${base}/rest/v1/rpc/recap_frames`, headers, { payload: frames }),
  };
}

/**
 * POSTs each batch as JSON to an endpoint you run. Screenshots go to `screenshotUrl` and recording
 * frames to `framesUrl` if you set them.
 */
export function endpointTransport(opts: {
  url: string;
  headers?: Record<string, string>;
  screenshotUrl?: string;
  framesUrl?: string;
}): Transport {
  return {
    send: (batch: IngestBatch) => postJSON(opts.url, opts.headers ?? {}, batch),
    ...(opts.screenshotUrl
      ? { sendScreenshot: (shot: ScreenshotPayload) => postJSON(opts.screenshotUrl!, opts.headers ?? {}, shot) }
      : {}),
    ...(opts.framesUrl
      ? { sendFrames: (frames: FramesPayload) => postJSON(opts.framesUrl!, opts.headers ?? {}, frames) }
      : {}),
  };
}
