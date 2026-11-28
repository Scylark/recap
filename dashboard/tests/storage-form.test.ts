import { describe, expect, it } from 'vitest';
import { fromForm, mb, toForm } from '../src/lib/storage';

const base = {
  keepDays: '90',
  sessionPct: '100',
  replayPct: '25',
  replayMinutes: '10',
  dailySessions: '',
  maxMb: '400',
  recordingLimits: true,
  recordingsMb: '300',
  visitMb: '10',
};

describe('storage limits form', () => {
  it('turns the form into database settings', () => {
    expect(fromForm(base)).toEqual({
      keep_days: 90,
      session_sample: 1,
      replay_sample: 0.25,
      max_frames: 600,
      daily_sessions: null,
      max_db_mb: 400,
      max_replay_mb: 300,
      max_visit_replay_mb: 10,
    });
    expect(fromForm({ ...base, keepDays: '', maxMb: '', recordingsMb: '', dailySessions: '500' })).toMatchObject({
      keep_days: null,
      max_db_mb: null,
      max_replay_mb: null,
      daily_sessions: 500,
    });
  });

  it('leaves the recording limits out on databases without them', () => {
    const older = toForm({
      keep_days: 90,
      session_sample: 1,
      replay_sample: 1,
      max_frames: 600,
      daily_sessions: null,
      max_db_mb: 400,
      last_purge_at: null,
      updated_at: '2026-11-28T00:00:00Z',
      updated_by: null,
    });
    expect(older.recordingLimits).toBe(false);
    const out = fromForm(older);
    expect(out).not.toHaveProperty('max_replay_mb');
    expect(out).not.toHaveProperty('max_visit_replay_mb');
  });

  it('explains bad values in plain words', () => {
    expect(fromForm({ ...base, sessionPct: '120' })).toBe('Sessions kept must be between 0 and 100%.');
    expect(fromForm({ ...base, maxMb: '10' })).toMatch(/at least 50 MB/);
    expect(fromForm({ ...base, dailySessions: '2.5' })).toMatch(/whole number/);
    expect(fromForm({ ...base, recordingsMb: '400' })).toMatch(/below the overall limit \(400 MB\)/);
    expect(fromForm({ ...base, recordingsMb: '0' })).toMatch(/recordings limit/);
    expect(fromForm({ ...base, visitMb: '' })).toMatch(/1 to 500 MB/);
    expect(fromForm({ ...base, visitMb: '501' })).toMatch(/1 to 500 MB/);
  });

  it('formats sizes', () => {
    expect(mb(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(mb(420 * 1024 * 1024)).toBe('420 MB');
  });
});
