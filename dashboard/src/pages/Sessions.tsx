import { useState } from 'react';
import { listSessions } from '../lib/data';
import { formatDateTime, formatDuration, go, sessionSeconds, useAsync } from '../lib/util';
import { Empty } from './Overview';

const PAGE = 50;

export function Sessions({ appId, since, screen }: { appId: string; since: string; screen?: string }) {
  const [platform, setPlatform] = useState('');
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(0);
  const res = useAsync(
    () =>
      listSessions({
        appId,
        since,
        limit: PAGE,
        offset: page * PAGE,
        ...(platform ? { platform } : {}),
        ...(userId ? { userId } : {}),
        ...(screen ? { screen } : {}),
      }),
    [appId, since, platform, userId, page, screen],
  );

  return (
    <>
      <h2>
        Sessions {screen && <span className="muted small">starting or ending on {screen}</span>}
      </h2>
      <div className="filters">
        <select value={platform} onChange={(e) => (setPlatform(e.target.value), setPage(0))}>
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
      {res.error && <p className="error">{res.error}</p>}
      {res.data && res.data.rows.length === 0 && <Empty />}
      {res.data && res.data.rows.length > 0 && (
        <>
          <table className="clickable">
            <thead>
              <tr>
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
                <tr key={s.id} onClick={() => go(`session/${s.id}`)}>
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
              Newer
            </button>
            <span className="muted small">
              {page * PAGE + 1} to {page * PAGE + res.data.rows.length} of {res.data.total}
            </span>
            <button disabled={(page + 1) * PAGE >= res.data.total} onClick={() => setPage(page + 1)}>
              Older
            </button>
          </div>
        </>
      )}
    </>
  );
}
