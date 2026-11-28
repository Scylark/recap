import { useState } from 'react';
import { PhoneIcon, RecordingIcon, SessionKind, WebIcon } from '../components/SessionKind';
import { listSessions } from '../lib/data';
import { formatDateTime, formatDuration, go, sessionSeconds, useAsync } from '../lib/util';
import { Empty } from './Overview';

const PAGE = 50;
const ORDER_KEY = 'recap-sessions-order';

type Order = 'recordings' | 'newest';

function savedOrder(): Order {
  try {
    return localStorage.getItem(ORDER_KEY) === 'newest' ? 'newest' : 'recordings';
  } catch {
    return 'recordings';
  }
}

export function Sessions({ appId, since, screen }: { appId: string; since: string; screen?: string }) {
  const [platform, setPlatform] = useState('');
  const [userId, setUserId] = useState('');
  const [order, setOrder] = useState<Order>(savedOrder);
  const [recording, setRecording] = useState<'' | 'with' | 'without'>('');
  const [page, setPage] = useState(0);
  const res = useAsync(
    () =>
      listSessions({
        appId,
        since,
        limit: PAGE,
        offset: page * PAGE,
        order,
        ...(recording ? { recording } : {}),
        ...(platform ? { platform } : {}),
        ...(userId ? { userId } : {}),
        ...(screen ? { screen } : {}),
      }),
    [appId, since, platform, userId, page, screen, order, recording],
  );
  const known = res.data?.recordingKnown ?? true;

  function changeOrder(next: Order) {
    setOrder(next);
    setPage(0);
    try {
      localStorage.setItem(ORDER_KEY, next);
    } catch {
      // Not saved for next time; the list still changes.
    }
  }

  return (
    <>
      <h2>
        Sessions {screen && <span className="muted small">starting or ending on {screen}</span>}
      </h2>
      <div className="filters">
        {known && (
          <>
            <select aria-label="Order" value={order} onChange={(e) => changeOrder(e.target.value as Order)}>
              <option value="recordings">Recordings first</option>
              <option value="newest">Newest first</option>
            </select>
            <select
              aria-label="Recording"
              value={recording}
              onChange={(e) => (setRecording(e.target.value as '' | 'with' | 'without'), setPage(0))}
            >
              <option value="">With or without a recording</option>
              <option value="with">With a recording</option>
              <option value="without">Without a recording</option>
            </select>
          </>
        )}
        <select aria-label="Platform" value={platform} onChange={(e) => (setPlatform(e.target.value), setPage(0))}>
          <option value="">All platforms</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
          <option value="web">Web</option>
        </select>
        <input
          placeholder="Search user id"
          value={userId}
          onChange={(e) => (setUserId(e.target.value), setPage(0))}
        />
        {screen && <a href="#/sessions">Clear screen filter</a>}
      </div>
      <p className="legend muted small">
        <span><WebIcon /> Web visit</span>
        <span><PhoneIcon /> App session</span>
        {known ? (
          <span className="rec-icon"><RecordingIcon /> <span className="muted">Has a recording</span></span>
        ) : (
          <span>
            To see which sessions have a recording, run <code>supabase/setup.sql</code> again in the Supabase SQL editor.
          </span>
        )}
      </p>
      {res.error && <p className="error">{res.error}</p>}
      {res.data && res.data.rows.length === 0 && <Empty />}
      {res.data && res.data.rows.length > 0 && (
        <>
          <table className="clickable">
            <thead>
              <tr>
                <th className="kind-col">
                  <span className="sr-only">Kind and recording</span>
                </th>
                <th>Started</th>
                <th>Length</th>
                <th>Journey</th>
                <th className="num">Screens</th>
                <th className="num">Taps</th>
                <th>Device</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {res.data.rows.map((s) => (
                <tr key={s.id} onClick={() => go(`session/${s.id}`)} className={s.has_recording ? 'recorded' : undefined}>
                  <td className="kind-col">
                    <SessionKind session={s} known={known} />
                  </td>
                  <td>{formatDateTime(s.started_at)}</td>
                  <td>{formatDuration(sessionSeconds(s))}</td>
                  <td>
                    {s.first_screen ?? '?'}
                    {s.last_screen && s.last_screen !== s.first_screen ? ` → ${s.last_screen}` : ''}
                  </td>
                  <td className="num">{s.screen_count}</td>
                  <td className="num">{s.tap_count}</td>
                  <td>
                    {s.platform ?? '?'} {s.os_version ?? ''}
                    {s.app_version ? <span className="muted"> · v{s.app_version}</span> : null}
                  </td>
                  <td className="muted">{s.user_id ?? 'anonymous'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              {order === 'recordings' && known ? 'Previous' : 'Newer'}
            </button>
            <span className="muted small">
              {page * PAGE + 1} to {page * PAGE + res.data.rows.length} of {res.data.total}
            </span>
            <button disabled={(page + 1) * PAGE >= res.data.total} onClick={() => setPage(page + 1)}>
              {order === 'recordings' && known ? 'Next' : 'Older'}
            </button>
          </div>
        </>
      )}
    </>
  );
}
