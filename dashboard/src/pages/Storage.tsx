import { useEffect, useState, type FormEvent } from 'react';
import { getStorageSettings, purgeNow, saveStorageSettings, storageUsage } from '../lib/data';
import { fromForm, mb, toForm, type Form } from '../lib/storage';
import { formatDateTime, useAsync } from '../lib/util';

const KEEP_OPTIONS: { days: number | null; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
  { days: null, label: 'Forever' },
];

const FREE_PLAN_MB = 500;

export function Storage({ isAdmin, me }: { isAdmin: boolean; me: string }) {
  const settings = useAsync(getStorageSettings, []);
  const usage = useAsync(storageUsage, []);
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(toForm(settings.data));
  }, [settings.data]);

  if (settings.loading) return <p className="muted">Loading…</p>;
  if (settings.error) return <p className="error">{settings.error}</p>;
  if (!settings.data) {
    return (
      <>
        <h2>Storage</h2>
        <div className="card empty">
          <h3>One more database step</h3>
          <p>
            Run <code>supabase/migrations/20261127030000_recap_storage_limits.sql</code> in your Supabase SQL editor,
            then refresh this page. It adds storage limits for every app, starting with 90 days of data kept and a 400 MB cap.
          </p>
        </div>
      </>
    );
  }

  const u = usage.data;
  const cap = settings.data.max_db_mb;
  const used = u ? u.recapBytes / (1024 * 1024) : 0;
  const share = cap ? Math.min(1, used / cap) : u ? Math.min(1, u.databaseBytes / (FREE_PLAN_MB * 1024 * 1024)) : 0;
  const full = cap != null && used >= cap;
  const set = (k: keyof Form) => (e: { target: { value: string } }) => form && setForm({ ...form, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const next = fromForm(form);
    if (typeof next === 'string') return setMsg({ ok: false, text: next });
    setBusy(true);
    try {
      await saveStorageSettings(next, me);
      setMsg({ ok: true, text: 'Saved. The new limits apply to the next session that starts, on every app.' });
      settings.reload();
      usage.reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function cleanUp() {
    const days = settings.data?.keep_days;
    if (days == null) return;
    if (!window.confirm(`Permanently delete every session older than ${days} days, with its replay?`)) return;
    setBusy(true);
    try {
      const n = await purgeNow();
      setMsg({ ok: true, text: `Deleted ${n.toLocaleString()} old session${n === 1 ? '' : 's'}.` });
      usage.reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Storage</h2>
      <p className="muted small">
        How much room Recap is using in your Supabase database, and the limits that stop it filling up. Limits are
        checked by the database, so they apply to every app (iOS, Android and web) straight away, with no app update.
      </p>

      {usage.error && <p className="error">{usage.error}</p>}
      <div className="card storage-meter">
        <div className="row space">
          <div>
            <div className="kpi-value">{u ? mb(u.recapBytes) : '…'}</div>
            <div className="kpi-label">
              Recap data{cap ? ` of your ${cap} MB limit` : ''}
              {u && ` · whole database ${mb(u.databaseBytes)} (Supabase's free plan allows ${FREE_PLAN_MB} MB)`}
            </div>
          </div>
          {full && <span className="pill warn">Limit reached: new sessions are paused</span>}
        </div>
        <div
          className={`meter${full ? ' full' : share > 0.8 ? ' high' : ''}`}
          role="meter"
          aria-label="Recap storage used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <span style={{ width: `${Math.max(1, share * 100)}%` }} />
        </div>
        {u && (
          <p className="muted small">
            {u.sessions.toLocaleString()} sessions ({u.sessionsToday.toLocaleString()} today),{' '}
            {u.sessionsWithReplay.toLocaleString()} with a replay. Replays {mb(u.framesBytes)}, events{' '}
            {mb(u.eventsBytes)}, heatmap pictures {mb(u.screenshotsBytes)}.
            {u.oldestSession && ` Oldest session ${formatDateTime(u.oldestSession)}.`}
          </p>
        )}
      </div>

      {form && (
        <form className="card storage-form" onSubmit={save}>
          <fieldset disabled={!isAdmin || busy}>
            <label>
              <span>Keep data for</span>
              <select value={form.keepDays} onChange={set('keepDays')}>
                {KEEP_OPTIONS.map((o) => (
                  <option key={o.label} value={o.days == null ? '' : String(o.days)}>
                    {o.label}
                  </option>
                ))}
              </select>
              <small>Older sessions and their replays are deleted automatically, about once an hour.</small>
            </label>
            <label>
              <span>Sessions kept</span>
              <span className="unit">
                <input inputMode="decimal" value={form.sessionPct} onChange={set('sessionPct')} /> %
              </span>
              <small>Share of new sessions saved. 10% on a busy app still shows the patterns.</small>
            </label>
            <label>
              <span>Replays kept</span>
              <span className="unit">
                <input inputMode="decimal" value={form.replayPct} onChange={set('replayPct')} /> %
              </span>
              <small>Share of saved sessions that also keep a replay. Replays take most of the room.</small>
            </label>
            <label>
              <span>Longest replay</span>
              <span className="unit">
                <input inputMode="decimal" value={form.replayMinutes} onChange={set('replayMinutes')} /> minutes
              </span>
              <small>A replay stops after this long. The rest of the session is still saved.</small>
            </label>
            <label>
              <span>New sessions a day</span>
              <input inputMode="numeric" placeholder="No limit" value={form.dailySessions} onChange={set('dailySessions')} />
              <small>Across all apps, reset at midnight UTC. Leave blank for no limit.</small>
            </label>
            <label>
              <span>Stop collecting at</span>
              <span className="unit">
                <input inputMode="numeric" placeholder="No limit" value={form.maxMb} onChange={set('maxMb')} /> MB
              </span>
              <small>New sessions and replays pause at this size until old data is deleted. 400 MB suits the free plan.</small>
            </label>
          </fieldset>
          {isAdmin ? (
            <div className="row">
              <button className="primary" disabled={busy}>
                Save limits
              </button>
              {settings.data.keep_days != null && (
                <button type="button" disabled={busy} onClick={() => void cleanUp()}>
                  Delete old data now
                </button>
              )}
            </div>
          ) : (
            <p className="muted small">Only admins can change these.</p>
          )}
          {settings.data.updated_by && (
            <p className="muted small">
              Last changed by {settings.data.updated_by}, {formatDateTime(settings.data.updated_at)}.
            </p>
          )}
        </form>
      )}
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
    </>
  );
}
