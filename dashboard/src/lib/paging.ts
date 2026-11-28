/**
 * Reading more rows than Supabase answers at once (1,000 a request, whatever the limit asked for),
 * newest first by the event's own time, with a keyset: each page starts after the last row read.
 *
 * Keyset rather than an offset, so rows arriving mid-read are never counted twice. By time (`at`,
 * then `id` to break ties) rather than by id, so the oldest row read really is the oldest time read:
 * an event queued offline arrives late with a new id and an old time, and paging by id let one
 * six-day-old tap pull a "newest 5,000" cut-off back six days.
 */

/** Supabase answers at most 1,000 rows a request. */
export const PAGE = 1000;

export interface Cursor {
  at: string;
  id: number;
}

/**
 * The PostgREST `or` filter for rows after `c` in (at desc, id desc) order: earlier in time, or at
 * the same time with a lower id. Times are quoted (they hold '.', ':' and '+').
 */
export function afterCursor(c: Cursor): string {
  const at = `"${String(c.at).replace(/["\\]/g, '')}"`;
  return `at.lt.${at},and(at.eq.${at},id.lt.${Math.trunc(Number(c.id))})`;
}

/**
 * Read up to `max` rows, newest first. `page(after, n)` builds one page's query: ordered by `at`
 * then `id`, both descending, filtered with `afterCursor(after)` when given, at most `n` rows.
 * `capped` is true only when there were more than `max` rows.
 */
export async function readNewest<T extends Cursor>(
  page: (after: Cursor | null, n: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  max: number,
): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  let after: Cursor | null = null;
  while (rows.length <= max) {
    const n = Math.min(PAGE, max + 1 - rows.length);
    const res = await page(after, n);
    if (res.error) throw new Error(res.error.message);
    const got = (res.data ?? []) as T[];
    rows.push(...got);
    if (got.length < n || !got.length) break;
    const last = got[got.length - 1]!;
    after = { at: last.at, id: last.id };
  }
  return { rows: rows.slice(0, max), capped: rows.length > max };
}

/**
 * Where lists read newest first start, so they cover the same time: the latest of the oldest times
 * of the lists that stopped short (each list's last row, as they are in time order), or `since`.
 */
export function commonStart(lists: { rows: { at: string }[]; capped: boolean }[], since: string): number {
  let from = Date.parse(since);
  for (const l of lists) {
    const last = l.rows[l.rows.length - 1];
    const t = last ? Date.parse(last.at) : NaN;
    if (l.capped && Number.isFinite(t)) from = Math.max(from, t);
  }
  return from;
}
