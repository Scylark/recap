import type { IngestBatch, Transport } from './types';

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
  return {
    send: (batch: IngestBatch) =>
      postJSON(
        `${base}/rest/v1/rpc/recap_ingest`,
        { apikey: opts.anonKey, Authorization: `Bearer ${opts.anonKey}` },
        { payload: batch },
      ),
  };
}

/** POSTs each batch as JSON to an endpoint you run. */
export function endpointTransport(opts: { url: string; headers?: Record<string, string> }): Transport {
  return { send: (batch: IngestBatch) => postJSON(opts.url, opts.headers ?? {}, batch) };
}
