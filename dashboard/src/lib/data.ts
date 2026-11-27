import { db } from './supabase';
import type { EventRow, Member, ScreenStat, SessionRow, TapPoint } from './types';

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
  limit?: number;
  offset?: number;
}

export async function listSessions(f: SessionFilter): Promise<{ rows: SessionRow[]; total: number }> {
  let q = db()
    .from('recap_sessions')
    .select('*', { count: 'exact' })
    .eq('app_id', f.appId)
    .gte('started_at', f.since)
    .order('started_at', { ascending: false })
    .range(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? 50) - 1);
  if (f.platform) q = q.eq('platform', f.platform);
  if (f.userId) q = q.ilike('user_id', `%${f.userId}%`);
  if (f.screen) {
    const v = `"${f.screen.replace(/"/g, '\\"')}"`;
    q = q.or(`first_screen.eq.${v},last_screen.eq.${v}`);
  }
  const res = await q;
  if (res.error) throw new Error(res.error.message);
  return { rows: (res.data ?? []) as SessionRow[], total: res.count ?? 0 };
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

export async function tapsOnScreen(appId: string, screen: string, since: string): Promise<TapPoint[]> {
  const rows = check(
    await db()
      .from('recap_events')
      .select('data')
      .eq('app_id', appId)
      .eq('type', 'tap')
      .eq('screen', screen)
      .gte('at', since)
      .limit(5000),
  ) as { data: Record<string, unknown> }[];
  return rows.map((r) => ({ nx: Number(r.data.nx ?? 0), ny: Number(r.data.ny ?? 0) }));
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

export interface LabelCount {
  label: string;
  count: number;
}

export async function topLabels(appId: string, screen: string, since: string): Promise<LabelCount[]> {
  const rows = check(
    await db()
      .from('recap_events')
      .select('data')
      .eq('app_id', appId)
      .eq('type', 'tap')
      .eq('screen', screen)
      .gte('at', since)
      .not('data->>label', 'is', null)
      .limit(5000),
  ) as { data: Record<string, unknown> }[];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const l = String(r.data.label);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
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
