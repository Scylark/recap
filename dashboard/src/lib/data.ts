import { db } from './supabase';
import { pickSnapshot, recordingOrder, type RecordedVisit, type TapRow } from './heatmap';
import { afterCursor, commonStart, readNewest } from './paging';
import type { EventRow, Member, ScreenStat, SessionRow } from './types';

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function myRole(): Promise<'admin' | 'viewer' | null> {
  const res = await db().rpc('recap_role');
  if (res.error) throw new Error(res.error.message);
  return (res.data as 'admin' | 'viewer' | null) ?? null;
}

export async function listApps(): Promise<string[]> {
  // Small projects: read app ids from the latest sessions, most recently active first.
  const rows = check(
    await db().from('recap_sessions').select('app_id').order('started_at', { ascending: false }).limit(1000),
  ) as { app_id: string }[];
  return [...new Set(rows.map((r) => r.app_id))];
}

export interface SessionFilter {
  appId: string;
  since: string;
  platform?: string;
  userId?: string;
  screen?: string;
  /** 'recordings' puts sessions with a recording first, newest first within each group. Default 'newest'. */
  order?: 'recordings' | 'newest';
  /** Only sessions with ('with') or without ('without') a recording. */
  recording?: 'with' | 'without';
  limit?: number;
  offset?: number;
}

export interface SessionPage {
  rows: SessionRow[];
  total: number;
  /** False on databases without the recording limits migration: they can't tell which sessions are recorded. */
  recordingKnown: boolean;
}

export async function listSessions(f: SessionFilter): Promise<SessionPage> {
  const run = (withRecording: boolean) => {
    let q = db().from('recap_sessions').select('*', { count: 'exact' }).eq('app_id', f.appId).gte('started_at', f.since);
    if (withRecording && f.order === 'recordings') q = q.order('has_recording', { ascending: false });
    q = q.order('started_at', { ascending: false }).range(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? 50) - 1);
    if (withRecording && f.recording) q = q.eq('has_recording', f.recording === 'with');
    if (f.platform) q = q.eq('platform', f.platform);
    if (f.userId) q = q.ilike('user_id', `%${f.userId}%`);
    if (f.screen) {
      const v = `"${f.screen.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      q = q.or(`first_screen.eq.${v},last_screen.eq.${v}`);
    }
    return q;
  };
  let recordingKnown = true;
  let res = await run(true);
  if (res.error && /has_recording|42703/.test(`${res.error.message} ${(res.error as { code?: string }).code ?? ''}`)) {
    recordingKnown = false;
    res = await run(false);
  }
  if (res.error) throw new Error(res.error.message);
  return { rows: (res.data ?? []) as SessionRow[], total: res.count ?? 0, recordingKnown };
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const rows = check(await db().from('recap_sessions').select('*').eq('id', id).limit(1)) as SessionRow[];
  return rows[0] ?? null;
}

export async function getEvents(sessionId: string): Promise<EventRow[]> {
  const out: EventRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = check(
      await db()
        .from('recap_events')
        .select('*')
        .eq('session_id', sessionId)
        .order('t_ms', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + page - 1),
    ) as EventRow[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export async function screenStats(appId: string, since: string): Promise<ScreenStat[]> {
  const rows = check(await db().rpc('recap_screen_stats', { p_app: appId, p_since: since })) as ScreenStat[];
  return rows.map((r) => ({
    ...r,
    views: Number(r.views),
    taps: Number(r.taps),
    sessions: Number(r.sessions),
    exits: Number(r.exits),
  }));
}

export interface Totals {
  sessions: number;
  avgDurationSec: number;
  avgScreens: number;
  taps: number;
  platforms: Record<string, number>;
}

export async function totals(appId: string, since: string): Promise<Totals> {
  const rows = check(
    await db()
      .from('recap_sessions')
      .select('started_at,last_seen_at,screen_count,tap_count,platform')
      .eq('app_id', appId)
      .gte('started_at', since)
      .limit(10000),
  ) as Pick<SessionRow, 'started_at' | 'last_seen_at' | 'screen_count' | 'tap_count' | 'platform'>[];
  const n = rows.length || 1;
  const platforms: Record<string, number> = {};
  let dur = 0;
  let screens = 0;
  let taps = 0;
  for (const r of rows) {
    dur += Math.max(0, (Date.parse(r.last_seen_at) - Date.parse(r.started_at)) / 1000);
    screens += r.screen_count;
    taps += r.tap_count;
    const p = r.platform ?? 'unknown';
    platforms[p] = (platforms[p] ?? 0) + 1;
  }
  return { sessions: rows.length, avgDurationSec: dur / n, avgScreens: screens / n, taps, platforms };
}

export interface Screenshot {
  image: string;
  width: number | null;
  height: number | null;
}

/**
 * A real picture rather than a blank stand-in. Builds that can't capture the screen (a web build, a
 * broken capture) can send a tiny image; showing it would hide the real pictures behind it.
 */
const usable = (image: string | null | undefined) => !!image && image.length > 400;

/** The newest picture of a screen, if the app sends them (`screenshots` in the SDK config). */
export async function screenshotFor(appId: string, screen: string): Promise<Screenshot | null> {
  const res = await db()
    .from('recap_screenshots')
    .select('image,width,height')
    .eq('app_id', appId)
    .eq('screen', screen)
    .order('captured_at', { ascending: false })
    .limit(10);
  // Older databases without the screenshots migration just show the plain grid.
  if (res.error) return null;
  return ((res.data ?? []) as Screenshot[]).find((r) => usable(r.image)) ?? null;
}

/** The newest picture of each of these screens, keyed by screen name. */
export async function screenshotsFor(appId: string, screens: string[]): Promise<Record<string, Screenshot>> {
  if (!screens.length) return {};
  const res = await db()
    .from('recap_screenshots')
    .select('screen,image,width,height,captured_at')
    .eq('app_id', appId)
    .in('screen', screens)
    .order('captured_at', { ascending: false })
    .limit(200);
  if (res.error) return {};
  const out: Record<string, Screenshot> = {};
  for (const r of (res.data ?? []) as (Screenshot & { screen: string })[]) if (!out[r.screen] && usable(r.image)) out[r.screen] = r;
  return out;
}

export interface Frame {
  t_ms: number;
  /** null while recording was paused for privacy. */
  image: string | null;
}

/** Recording frames for a session, oldest first. Empty when the app doesn't send recordings. */
export async function getFrames(sessionId: string): Promise<Frame[]> {
  const out: Frame[] = [];
  // Pages of 200 keep each response small (frames are pictures).
  for (let from = 0; from < 3600; from += 200) {
    const res = await db()
      .from('recap_frames')
      .select('t_ms,image')
      .eq('session_id', sessionId)
      .order('t_ms', { ascending: true })
      .range(from, from + 199);
    if (res.error) return out; // older databases without the recordings migration
    const rows = (res.data ?? []) as Frame[];
    out.push(...rows.filter((f) => f.image === null || usable(f.image)));
    if (rows.length < 200) break;
  }
  return out;
}

/** One rrweb event from a web page recording. */
export interface DomEvent {
  type: number;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * A website's page recording (rrweb events), oldest first, plus when it starts in the session's
 * timeline. Empty when the session isn't a recorded web session.
 */
export async function getDomRecording(sessionId: string): Promise<{ events: DomEvent[]; startMs: number }> {
  const events: DomEvent[] = [];
  let startMs = 0;
  for (let from = 0; from < 2000; from += 100) {
    const res = await db()
      .from('recap_dom')
      .select('t_ms,events')
      .eq('session_id', sessionId)
      .order('t_ms', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 99);
    if (res.error) break; // older databases without the web recordings migration
    const rows = (res.data ?? []) as { t_ms: number; events: DomEvent[] }[];
    if (from === 0 && rows[0]) startMs = rows[0].t_ms;
    for (const r of rows) if (Array.isArray(r.events)) events.push(...r.events);
    if (rows.length < 100) break;
  }
  events.sort((a, b) => a.timestamp - b.timestamp);
  return { events, startMs };
}

// ------------------------------------------------------------------ heatmaps

/** Everything the Heatmaps page needs for one screen: taps, visits and how far each visit scrolled. */
export interface ScreenActivity {
  taps: TapRow[];
  /** One entry per visit to the screen (session id and when, in the session's timeline). */
  views: { sessionId: string; tMs: number }[];
  /** The furthest each session scrolled on this screen, 0-100. */
  maxDepth: Map<string, number>;
  /** What each session said about its device, by session id. */
  sessions: Map<string, HeatmapSession>;
  /** True when the period held more than the page reads: then taps, views and scrolls all start at `from`. */
  capped: boolean;
  from: string;
}

export interface HeatmapSession {
  id: string;
  platform: string | null;
  screen_width: number | null;
  screen_height: number | null;
  started_at: string;
  has_recording?: boolean;
}

export const HEATMAP_TAP_LIMIT = 5000;
export const HEATMAP_VIEW_LIMIT = 5000;
const HEATMAP_SCROLL_LIMIT = 10000;

/** Sessions by id, 150 to a request and six requests at a time (a busy screen has thousands). */
async function sessionsById(ids: string[]): Promise<Map<string, HeatmapSession>> {
  const out = new Map<string, HeatmapSession>();
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 150) chunks.push(unique.slice(i, i + 150));
  let withRecording = true;
  const one = async (chunk: string[]) => {
    const run = (rec: boolean) =>
      db()
        .from('recap_sessions')
        .select(`id,platform,screen_width,screen_height,started_at${rec ? ',has_recording' : ''}`)
        .in('id', chunk);
    let res = await run(withRecording);
    if (res.error && /has_recording|42703/.test(`${res.error.message} ${(res.error as { code?: string }).code ?? ''}`)) {
      withRecording = false; // a database from before the recording limits
      res = await run(false);
    }
    for (const r of check(res) as unknown as HeatmapSession[]) out.set(r.id, r);
  };
  for (let i = 0; i < chunks.length; i += 6) await Promise.all(chunks.slice(i, i + 6).map(one));
  return out;
}

export interface EventSessions {
  sessions: Set<string>;
  /** True when there were more events than were read, so some sessions may be missing. */
  capped: boolean;
}

/** Sessions in the period that sent this custom event (for "visits that signed up" and the like). */
export async function sessionsWithEvent(appId: string, name: string, since: string): Promise<EventSessions> {
  const { rows, capped } = await readNewest<{ id: number; at: string; session_id: string }>((after, n) => {
    let q = db()
      .from('recap_events')
      .select('id,at,session_id')
      .eq('app_id', appId)
      .eq('type', 'custom')
      .eq('data->>name', name)
      .gte('at', since);
    if (after) q = q.or(afterCursor(after));
    return q.order('at', { ascending: false }).order('id', { ascending: false }).limit(n);
  }, 20000);
  return { sessions: new Set(rows.map((r) => r.session_id)), capped };
}

export async function screenActivity(appId: string, screen: string, since: string): Promise<ScreenActivity> {
  const events = <T extends { id: number; at: string }>(type: 'tap' | 'screen' | 'scroll', select: string, max: number) =>
    readNewest<T>((after, n) => {
      let q = db().from('recap_events').select(select).eq('app_id', appId).eq('type', type).eq('screen', screen).gte('at', since);
      if (after) q = q.or(afterCursor(after));
      return q.order('at', { ascending: false }).order('id', { ascending: false }).limit(n);
    }, max);
  type Tap = { id: number; session_id: string; t_ms: number; at: string; data: Record<string, unknown> };
  type View = { id: number; session_id: string; t_ms: number; at: string };
  type Scroll = { id: number; session_id: string; at: string; data: Record<string, unknown> };
  const [tapRes, viewRes, scrollRes] = await Promise.all([
    events<Tap>('tap', 'id,session_id,t_ms,at,data', HEATMAP_TAP_LIMIT),
    events<View>('screen', 'id,session_id,t_ms,at', HEATMAP_VIEW_LIMIT),
    events<Scroll>('scroll', 'id,session_id,at,data', HEATMAP_SCROLL_LIMIT),
  ]);
  // When a list stopped short, all three start where the shortest one did, so "of visits" and
  // "how far down" compare the same visits. Times compared as times, whatever their offset.
  const ms = (at: string) => Date.parse(at);
  const fromMs = commonStart([tapRes, viewRes, scrollRes], since);
  const narrowed = fromMs > ms(since);
  const inSpan = <T extends { at: string }>(rows: T[]) => (narrowed ? rows.filter((r) => ms(r.at) >= fromMs) : rows);
  const taps = inSpan(tapRes.rows);
  const views = inSpan(viewRes.rows).map((v) => ({ sessionId: v.session_id, tMs: v.t_ms }));
  const maxDepth = new Map<string, number>();
  for (const s of inSpan(scrollRes.rows)) {
    const d = Number(s.data?.maxDepth ?? s.data?.depth ?? 0);
    if (Number.isFinite(d)) maxDepth.set(s.session_id, Math.max(maxDepth.get(s.session_id) ?? 0, d));
  }
  const sessions = await sessionsById([...taps.map((t) => t.session_id), ...views.map((v) => v.sessionId)]);
  return {
    taps: taps.map((t) => {
      const s = sessions.get(t.session_id);
      return { sessionId: t.session_id, tMs: t.t_ms, platform: s?.platform ?? null, vw: s?.screen_width ?? null, vh: s?.screen_height ?? null, data: t.data ?? {} };
    }),
    views,
    maxDepth,
    sessions,
    capped: narrowed,
    from: narrowed ? new Date(fromMs).toISOString() : since,
  };
}

/** A page as it was drawn: rrweb's meta event and full snapshot, from one recorded visit. */
export interface PageSnapshot {
  sessionId: string;
  startedAt: string;
  events: DomEvent[];
  width: number;
  height: number;
  /** Where this visit is in the list tried, so the page can ask for the next one. */
  index: number;
}

/**
 * A recording of this screen: the full snapshot rrweb took when the screen loaded, from the first
 * visit in `recordingOrder` (starting at `from`) that has one. The web script takes a full snapshot
 * when a page loads, so a screen reached without a page load (a single-page app) has none of its own.
 *
 * Kept cheap, as it runs whenever the page opens: per visit, one query for where the visit went next,
 * one for the ids of chunks holding a full snapshot in that window (the database filters them), and
 * then only those chunks are read. It gives up after three visits with no snapshot of their own, and
 * a recording skipped for an untrustworthy size doesn't count towards that.
 */
export async function pageSnapshotFor(
  visits: RecordedVisit[],
  from = 0,
  width?: number | null,
  maxMisses = 3,
  maxVisits = 12,
): Promise<PageSnapshot | null> {
  const ordered = recordingOrder(visits, width);
  let misses = 0;
  let looked = 0;
  for (let index = Math.max(0, from); index < ordered.length && misses < maxMisses && looked < maxVisits; index++) {
    const v = ordered[index]!;
    looked++;
    // Where the visit went next, so a snapshot of the next screen isn't taken for this one.
    let untilMs = v.untilMs;
    if (untilMs === undefined) {
      const next = await db()
        .from('recap_events')
        .select('t_ms')
        .eq('session_id', v.sessionId)
        .eq('type', 'screen')
        .gt('t_ms', v.tMs)
        .order('t_ms', { ascending: true })
        .limit(1);
      const row = ((next.data ?? []) as { t_ms: number }[])[0];
      if (row) untilMs = row.t_ms;
    }
    // Only the chunks holding a full snapshot (rrweb event type 2), between the view and the next screen.
    let list = db()
      .from('recap_dom')
      .select('id,t_ms')
      .eq('session_id', v.sessionId)
      .gte('t_ms', Math.max(0, v.tMs - 1000))
      .filter('events', 'cs', '[{"type":2}]');
    if (untilMs !== undefined) list = list.lt('t_ms', untilMs);
    const chunks = await list.order('t_ms', { ascending: true }).order('id', { ascending: true }).limit(3);
    if (chunks.error) return null; // older databases without web recordings
    // rrweb's clock and the session's are the same browser's: keep to this visit to the screen.
    const startedAt = Date.parse(v.startedAt);
    const viewedAt = startedAt + v.tMs - 1000;
    const leftAt = untilMs !== undefined ? startedAt + untilMs : Infinity;
    let picked: ReturnType<typeof pickSnapshot> = 'miss';
    for (const c of ((chunks.data ?? []) as { id: number }[]).slice(0, 2)) {
      const res = await db().from('recap_dom').select('events').eq('id', c.id).limit(1);
      const row = ((res.data ?? []) as { events: DomEvent[] }[])[0];
      if (!row || !Array.isArray(row.events)) continue;
      picked = pickSnapshot(row.events, viewedAt, leftAt, { width: v.width, height: v.height });
      if (picked !== 'miss') break; // 'miss': a snapshot of the screen before
    }
    if (picked === 'miss') {
      misses++;
      continue;
    }
    // Its window decides how large the page and its canvas are drawn, and anyone with the public key
    // can upload a recording: one whose window doesn't match its session's is skipped.
    if (picked === 'untrusted') continue;
    return { sessionId: v.sessionId, startedAt: v.startedAt, events: picked.events as DomEvent[], width: picked.width, height: picked.height, index };
  }
  return null;
}

export async function listMembers(): Promise<Member[]> {
  return check(await db().from('recap_members').select('*').order('email')) as Member[];
}

export async function addMember(email: string, role: Member['role']): Promise<void> {
  check(await db().from('recap_members').insert({ email: email.trim().toLowerCase(), role }));
}

export async function removeMember(email: string): Promise<void> {
  check(await db().from('recap_members').delete().eq('email', email));
}

export async function deleteSession(id: string): Promise<void> {
  check(await db().from('recap_sessions').delete().eq('id', id));
}

export async function forgetUser(userId: string): Promise<number> {
  return check(await db().rpc('recap_forget_user', { p_user_id: userId })) as number;
}

// ------------------------------------------------------------------ storage limits

export interface StorageSettings {
  id?: number;
  keep_days: number | null;
  session_sample: number;
  replay_sample: number;
  max_frames: number;
  daily_sessions: number | null;
  max_db_mb: number | null;
  /** New recordings stop once all recordings reach this size. Missing before the recording limits migration. */
  max_replay_mb?: number | null;
  /** Most recording kept for one visit, in MB. Missing before the recording limits migration. */
  max_visit_replay_mb?: number;
  last_purge_at: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface StorageUsage {
  databaseBytes: number;
  recapBytes: number;
  /** All recordings (app replays and web page recordings). Missing before the recording limits migration. */
  recordingsBytes?: number;
  sessionsBytes: number;
  eventsBytes: number;
  framesBytes: number;
  /** Web page recordings. Missing on databases without the web recordings limits migration. */
  webReplayBytes?: number;
  screenshotsBytes: number;
  sessions: number;
  sessionsToday: number;
  sessionsWithReplay: number;
  oldestSession: string | null;
}

/** Null when the storage limits migration hasn't been run on this database yet. */
export async function getStorageSettings(): Promise<StorageSettings | null> {
  const res = await db().from('recap_settings').select('*').eq('id', 1).limit(1);
  if (res.error) {
    if (/recap_settings|PGRST205|42P01|not found/i.test(`${res.error.message} ${(res.error as { code?: string }).code ?? ''}`)) return null;
    throw new Error(res.error.message);
  }
  return ((res.data as StorageSettings[] | null) ?? [])[0] ?? null;
}

export type StorageSettingsInput = Pick<
  StorageSettings,
  'keep_days' | 'session_sample' | 'replay_sample' | 'max_frames' | 'daily_sessions' | 'max_db_mb' | 'max_replay_mb' | 'max_visit_replay_mb'
>;

export async function saveStorageSettings(s: StorageSettingsInput, by: string): Promise<void> {
  check(await db().from('recap_settings').update({ ...s, updated_by: by, updated_at: new Date().toISOString() }).eq('id', 1));
}

export async function storageUsage(): Promise<StorageUsage> {
  return check(await db().rpc('recap_storage_usage')) as StorageUsage;
}

export async function purgeNow(): Promise<number> {
  return check(await db().rpc('recap_purge_now')) as number;
}
