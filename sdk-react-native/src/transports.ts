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

/**
 * Sends batches to the `recap_ingest` function created by supabase/migrations.
 * Uses the project's public anon key, which can only call that function: it cannot read any data.
 */
export function supabaseTransport(opts: { url: string; anonKey: string }): Transport {
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
