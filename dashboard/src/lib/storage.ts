// Pure helpers for the Storage page (no Supabase), so they can be unit tested.
import type { StorageSettings, StorageSettingsInput } from './data';

export function mb(bytes: number): string {
  const v = bytes / (1024 * 1024);
  if (v > 0 && v < 0.1) return 'under 0.1 MB';
  return v >= 100 ? `${Math.round(v)} MB` : v >= 10 ? `${v.toFixed(0)} MB` : `${v.toFixed(1)} MB`;
}

export interface Form {
  keepDays: string; // '' = forever
  sessionPct: string;
  replayPct: string;
  replayMinutes: string;
  dailySessions: string; // '' = no limit
  maxMb: string; // '' = no limit
  /** False on databases without the recording limits migration: the two fields below are left out. */
  recordingLimits: boolean;
  recordingsMb: string; // '' = no limit
  visitMb: string;
}

export function toForm(s: StorageSettings): Form {
  return {
    keepDays: s.keep_days == null ? '' : String(s.keep_days),
    sessionPct: String(Math.round(s.session_sample * 100)),
    replayPct: String(Math.round(s.replay_sample * 100)),
    replayMinutes: String(Math.round((s.max_frames / 60) * 10) / 10),
    dailySessions: s.daily_sessions == null ? '' : String(s.daily_sessions),
    maxMb: s.max_db_mb == null ? '' : String(s.max_db_mb),
    recordingLimits: s.max_visit_replay_mb !== undefined,
    recordingsMb: s.max_replay_mb == null ? '' : String(s.max_replay_mb),
    visitMb: String(s.max_visit_replay_mb ?? 10),
  };
}

/** Turns the form into settings, or returns the first problem in plain words. */
export function fromForm(f: Form): StorageSettingsInput | string {
  const pct = (v: string, name: string) => {
    const n = Number(v);
    return v.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100 ? `${name} must be between 0 and 100%.` : n / 100;
  };
  const session = pct(f.sessionPct, 'Sessions kept');
  if (typeof session === 'string') return session;
  const replay = pct(f.replayPct, 'Replays kept');
  if (typeof replay === 'string') return replay;
  const minutes = Number(f.replayMinutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60) return 'Replay length must be between 0 and 60 minutes.';
  const daily = f.dailySessions.trim() === '' ? null : Number(f.dailySessions);
  if (daily != null && (!Number.isInteger(daily) || daily < 0)) return 'New sessions a day must be a whole number, or blank for no limit.';
  const maxMb = f.maxMb.trim() === '' ? null : Number(f.maxMb);
  if (maxMb != null && (!Number.isInteger(maxMb) || maxMb < 50)) return 'The size limit must be at least 50 MB, or blank for no limit.';
  const out: StorageSettingsInput = {
    keep_days: f.keepDays === '' ? null : Number(f.keepDays),
    session_sample: session,
    replay_sample: replay,
    max_frames: Math.round(minutes * 60),
    daily_sessions: daily,
    max_db_mb: maxMb,
  };
  if (!f.recordingLimits) return out;
  const recMb = f.recordingsMb.trim() === '' ? null : Number(f.recordingsMb);
  if (recMb != null && (!Number.isInteger(recMb) || recMb < 1)) return 'The recordings limit must be a whole number of MB, or blank for no limit.';
  if (recMb != null && maxMb != null && recMb >= maxMb) {
    return `The recordings limit must be below the overall limit (${maxMb} MB), so visits keep being counted after recordings stop.`;
  }
  const visit = Number(f.visitMb);
  if (f.visitMb.trim() === '' || !Number.isInteger(visit) || visit < 1 || visit > 500) return 'Recording per visit must be a whole number from 1 to 500 MB.';
  return { ...out, max_replay_mb: recMb, max_visit_replay_mb: visit };
}
