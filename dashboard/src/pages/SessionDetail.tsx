import { useMemo, useState } from 'react';
import { Heatmap } from '../components/Heatmap';
import { deleteSession, getEvents, getSession, screenshotFor } from '../lib/data';
import { summaryForAI } from '../lib/summary';
import type { EventRow, SessionRow } from '../lib/types';
import { formatDateTime, formatDuration, go, sessionSeconds, useAsync } from '../lib/util';

interface Visit {
  screen: string;
  startMs: number;
  endMs: number;
  events: EventRow[];
}

function visits(events: EventRow[], endMs: number): Visit[] {
  const out: Visit[] = [];
  for (const e of events) {
    const screen = e.screen ?? 'Unknown screen';
    const last = out[out.length - 1];
    if (e.type === 'screen' || !last || last.screen !== screen) {
      if (last) last.endMs = e.t_ms;
      out.push({ screen, startMs: e.t_ms, endMs: e.t_ms, events: e.type === 'screen' ? [] : [e] });
    } else {
      last.events.push(e);
    }
  }
  const last = out[out.length - 1];
  if (last) last.endMs = Math.max(last.endMs, endMs, last.events[last.events.length - 1]?.t_ms ?? 0);
  return out;
}

function describe(e: EventRow): string {
  switch (e.type) {
    case 'tap':
      return e.data.label ? `Tapped “${String(e.data.label)}”` : `Tapped at ${Math.round(Number(e.data.nx) * 100)}% across, ${Math.round(Number(e.data.ny) * 100)}% down`;
    case 'scroll':
      return `Scrolled to ${String(e.data.depth)}%`;
    case 'app_state':
      return e.data.state === 'background' ? 'Left the app' : `Came back${e.data.awayMs ? ` after ${formatDuration(Number(e.data.awayMs) / 1000)}` : ''}`;
    case 'custom': {
      const { name, ...rest } = e.data;
      const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
      return `Event: ${String(name)}${extra}`;
    }
    default:
      return e.type;
  }
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function SessionDetail({ id, isAdmin }: { id: string; isAdmin: boolean }) {
  const res = useAsync(async () => {
    const [session, events] = await Promise.all([getSession(id), getEvents(id)]);
    return { session, events };
  }, [id]);
  const [copied, setCopied] = useState<string | null>(null);

  if (res.error) return <p className="error">{res.error}</p>;
  if (!res.data) return <p className="muted">Loading…</p>;
  const { session, events } = res.data;
  if (!session) return <p>Session not found. It may have been deleted by the retention policy.</p>;

  return <Detail session={session} events={events} isAdmin={isAdmin} copied={copied} setCopied={setCopied} />;
}

function Detail({
  session,
  events,
  isAdmin,
  copied,
  setCopied,
}: {
  session: SessionRow;
  events: EventRow[];
  isAdmin: boolean;
  copied: string | null;
  setCopied: (s: string | null) => void;
}) {
  const duration = sessionSeconds(session);
  const v = useMemo(() => visits(events, duration * 1000), [events, duration]);
  const [selected, setSelected] = useState<number>(0);
  const visit = v[selected];
  const aspect = session.screen_width && session.screen_height ? session.screen_height / session.screen_width : undefined;
  const shot = useAsync(
    () => (visit ? screenshotFor(session.app_id, visit.screen) : Promise.resolve(null)),
    [session.app_id, visit?.screen],
  );
  const points = (visit?.events ?? [])
    .filter((e) => e.type === 'tap')
    .map((e) => ({ nx: Number(e.data.nx ?? 0), ny: Number(e.data.ny ?? 0) }));

  async function copySummary() {
    const text = summaryForAI(session, events);
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied. Paste it into Claude or ChatGPT.');
    } catch {
      const blob = new Blob([text], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `recap-session-${session.id.slice(0, 8)}.md`;
      a.click();
      setCopied('Downloaded the summary file.');
    }
    setTimeout(() => setCopied(null), 4000);
  }

  async function remove() {
    if (!window.confirm('Delete this session permanently?')) return;
    await deleteSession(session.id);
    go('sessions');
  }

  return (
    <>
      <p>
        <a href="#/sessions">← Sessions</a>
      </p>
      <div className="row space">
        <div>
          <h2>{formatDateTime(session.started_at)} · {formatDuration(duration)}</h2>
          <p className="muted small">
            {session.platform ?? '?'} {session.os_version ?? ''} {session.device_model ? `· ${session.device_model}` : ''}
            {session.app_version ? ` · app v${session.app_version}` : ''} · {session.user_id ?? 'anonymous user'} ·{' '}
            {session.screen_count} screens, {session.tap_count} taps
          </p>
        </div>
        <div className="row">
          <button className="primary" onClick={copySummary} title="A plain-English summary plus prompt, ready for an AI assistant">
            Copy AI summary
          </button>
          {isAdmin && <button onClick={remove}>Delete</button>}
        </div>
      </div>
      {copied && <p className="ok">{copied}</p>}

      <div className="detail">
        <ol className="journey">
          {v.map((visit, i) => (
            <li key={i} className={i === selected ? 'visit active' : 'visit'} onClick={() => setSelected(i)}>
              <div className="visit-head">
                <strong>{visit.screen}</strong>
                <span className="muted small">
                  {sec(visit.startMs)} · {formatDuration((visit.endMs - visit.startMs) / 1000)}
                </span>
              </div>
              {visit.events.length > 0 && (
                <ul>
                  {visit.events.map((e) => (
                    <li key={e.id}>
                      <span className="muted small mono">{sec(e.t_ms)}</span> {describe(e)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {v.length === 0 && <li className="muted">No events in this session.</li>}
        </ol>
        <div className="side">
          <h3>{visit?.screen ?? 'Screen'}</h3>
          <p className="muted small">Taps during this visit</p>
          <Heatmap points={points} backgroundUrl={shot.data?.image ?? null} {...(aspect ? { aspect } : {})} />
          {visit && (
            <p>
              <a href={`#/heatmaps/${encodeURIComponent(visit.screen)}`}>All taps on this screen →</a>
            </p>
          )}
        </div>
      </div>
    </>
  );
}
