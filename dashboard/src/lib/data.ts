import { db } from './supabase';
import type { TapRow } from './heatmap';
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
      const v = `"${f.screen.replace(/"/g, '\\"')}"`;
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
  /** True when there were more taps than the page reads (the newest are shown). */
  capped: boolean;
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

/** Sessions in the period that sent this custom event (for "visits that signed up" and the like). */
export async function sessionsWithEvent(appId: string, name: string, since: string): Promise<Set<string>> {
  const rows = check(
    await db()
      .from('recap_events')
      .select('session_id')
      .eq('app_id', appId)
      .eq('type', 'custom')
      .eq('data->>name', name)
      .gte('at', since)
      .limit(20000),
  ) as { session_id: string }[];
  return new Set(rows.map((r) => r.session_id));
}

export async function screenActivity(appId: string, screen: string, since: string): Promise<ScreenActivity> {
  const events = (type: 'tap' | 'screen' | 'scroll', select: string, limit: number) =>
    db()
      .from('recap_events')
      .select(select)
      .eq('app_id', appId)
      .eq('type', type)
      .eq('screen', screen)
      .gte('at', since)
      .order('at', { ascending: false })
      .limit(limit);
  const [tapRes, viewRes, scrollRes] = await Promise.all([
    events('tap', 'session_id,t_ms,data', HEATMAP_TAP_LIMIT),
    events('screen', 'session_id,t_ms', 5000),
    events('scroll', 'session_id,data', 10000),
  ]);
  const taps = check(tapRes) as unknown as { session_id: string; t_ms: number; data: Record<string, unknown> }[];
  const views = (check(viewRes) as unknown as { session_id: string; t_ms: number }[]).map((v) => ({ sessionId: v.session_id, tMs: v.t_ms }));
  const maxDepth = new Map<string, number>();
  for (const s of check(scrollRes) as unknown as { session_id: string; data: Record<string, unknown> }[]) {
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
    capped: taps.length >= HEATMAP_TAP_LIMIT,
  };
}

/** A page as it was drawn: rrweb's meta event and full snapshot, from one recorded visit. */
export interface PageSnapshot {
  sessionId: string;
  startedAt: string;
  events: DomEvent[];
  width: number;
  height: number;
  /** Where this visit is in the newest-first list, so the page can ask for the next one. */
  index: number;
}

/**
 * The newest recording of this screen among these visits: the first full snapshot rrweb took after
 * the visit opened the screen. Tries a few visits, newest first, and reads only the chunks around
 * the screen view, so it stays small.
 */
export async function pageSnapshotFor(
  visits: { sessionId: string; tMs: number; startedAt: string }[],
  from = 0,
  tries = 4,
): Promise<PageSnapshot | null> {
  const seen = new Set<string>();
  const ordered = [...visits]
    .sort((a, b) => Date.parse(b.startedAt) + b.tMs - (Date.parse(a.startedAt) + a.tMs))
    .filter((v) => {
      const key = `${v.sessionId}:${v.tMs}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
  let attempts = 0;
  for (let index = Math.max(0, from); index < ordered.length; index++) {
    const v = ordered[index]!;
    if (attempts >= tries) break;
    attempts++;
    const res = await db()
      .from('recap_dom')
      .select('t_ms,events')
      .eq('session_id', v.sessionId)
      .gte('t_ms', Math.max(0, v.tMs - 3000))
      .order('t_ms', { ascending: true })
      .order('id', { ascending: true })
      .limit(12);
    if (res.error) return null; // older databases without web recordings
    const events: DomEvent[] = [];
    for (const r of (res.data ?? []) as { events: DomEvent[] }[]) if (Array.isArray(r.events)) events.push(...r.events);
    events.sort((a, b) => a.timestamp - b.timestamp);
    // rrweb's clock and the session's are the same browser's: skip a snapshot of the screen before.
    const viewedAt = Date.parse(v.startedAt) + v.tMs;
    const fullAt = events.findIndex((e) => e.type === 2 && (!Number.isFinite(viewedAt) || e.timestamp >= viewedAt - 1000));
    if (fullAt < 0) continue;
    let meta: DomEvent | undefined;
    for (let i = fullAt - 1; i >= 0; i--) if (events[i]!.type === 4) (meta = events[i]), (i = -1);
    const m = (meta?.data ?? {}) as { width?: number; height?: number; href?: string };
    const full = events[fullAt]!;
    if (!meta) meta = { type: 4, timestamp: full.timestamp - 1, data: { href: 'about:blank', width: 0, height: 0 } };
    return { sessionId: v.sessionId, startedAt: v.startedAt, events: [meta, full], width: Number(m.width) || 0, height: Number(m.height) || 0, index };
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
