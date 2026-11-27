import { describe, expect, it } from 'vitest';
import { fromForm, mb } from '../src/lib/storage';

const base = { keepDays: '90', sessionPct: '100', replayPct: '25', replayMinutes: '10', dailySessions: '', maxMb: '400' };

describe('storage limits form', () => {
  it('turns the form into database settings', () => {
    expect(fromForm(base)).toEqual({
      keep_days: 90,
      session_sample: 1,
      replay_sample: 0.25,
      max_frames: 600,
      daily_sessions: null,
      max_db_mb: 400,
    });
    expect(fromForm({ ...base, keepDays: '', maxMb: '', dailySessions: '500' })).toMatchObject({
      keep_days: null,
      max_db_mb: null,
      daily_sessions: 500,
    });
  });

  it('explains bad values in plain words', () => {
    expect(fromForm({ ...base, sessionPct: '120' })).toBe('Sessions kept must be between 0 and 100%.');
    expect(fromForm({ ...base, maxMb: '10' })).toMatch(/at least 50 MB/);
    expect(fromForm({ ...base, dailySessions: '2.5' })).toMatch(/whole number/);
  });

  it('formats sizes', () => {
    expect(mb(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(mb(420 * 1024 * 1024)).toBe('420 MB');
  });
});
