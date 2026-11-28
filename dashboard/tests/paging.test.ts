import { describe, expect, it } from 'vitest';
import { afterCursor, commonStart, readNewest, type Cursor } from '../src/lib/paging';

interface Row extends Cursor {
  kind: string;
}

/** A table that pages like PostgREST: ordered by (at desc, id desc), after a cursor, n rows. */
function table(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => (a.at === b.at ? b.id - a.id : a.at < b.at ? 1 : -1));
  let requests = 0;
  const page = (after: Cursor | null, n: number) => {
    requests++;
    const from = after ? sorted.filter((r) => r.at < after.at || (r.at === after.at && r.id < after.id)) : sorted;
    return Promise.resolve({ data: from.slice(0, n), error: null });
  };
  return { page, requests: () => requests };
}

const iso = (ms: number) => new Date(ms).toISOString();
const NOW = Date.parse('2026-11-28T12:00:00.000Z');
const DAY = 86_400_000;

describe('reading newest first by time', () => {
  it('a late event with an old time does not pull the cut-off back', () => {
    // 6,000 taps over the last day, then one tap made six days ago that only arrived now (highest id).
    const rows: Row[] = [];
    for (let i = 0; i < 6000; i++) rows.push({ id: i + 1, at: iso(NOW - Math.floor((i / 6000) * DAY)), kind: 'tap' });
    rows.push({ id: 999999, at: iso(NOW - 6 * DAY), kind: 'late' });
    const t = table(rows);
    return readNewest<Row>(t.page, 5000).then(({ rows: got, capped }) => {
      expect(capped).toBe(true);
      expect(got).toHaveLength(5000);
      expect(got.some((r) => r.kind === 'late')).toBe(false);
      const start = commonStart([{ rows: got, capped }], iso(NOW - 7 * DAY));
      expect(NOW - start).toBeLessThan(DAY);
      // Five pages of 1,000, then one row to learn there were more.
      expect(t.requests()).toBe(6);
    });
  });

  it('counts ties at the same time once, and is not capped at exactly the limit', async () => {
    const same = iso(NOW);
    const rows: Row[] = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, at: same, kind: 'tap' }));
    const all = await readNewest<Row>(table(rows).page, 2500);
    expect(all.capped).toBe(false);
    expect(new Set(all.rows.map((r) => r.id)).size).toBe(2500);
    const some = await readNewest<Row>(table(rows).page, 2499);
    expect(some.capped).toBe(true);
    expect(some.rows).toHaveLength(2499);
  });

  it('starts every list at the latest of the capped lists\' oldest times', () => {
    const a = { rows: [{ at: iso(NOW) }, { at: iso(NOW - 2 * DAY) }], capped: true };
    const b = { rows: [{ at: iso(NOW) }, { at: iso(NOW - DAY) }], capped: true };
    const c = { rows: [{ at: iso(NOW - 5 * DAY) }], capped: false };
    expect(commonStart([a, b, c], iso(NOW - 7 * DAY))).toBe(NOW - DAY);
    expect(commonStart([c], iso(NOW - 7 * DAY))).toBe(NOW - 7 * DAY);
  });

  it('writes the cursor as a PostgREST filter with the time quoted', () => {
    expect(afterCursor({ at: '2026-11-28T08:00:00.123+00:00', id: 42 })).toBe(
      'at.lt."2026-11-28T08:00:00.123+00:00",and(at.eq."2026-11-28T08:00:00.123+00:00",id.lt.42)',
    );
  });
});
