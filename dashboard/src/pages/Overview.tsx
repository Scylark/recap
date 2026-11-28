import { screenStats, totals } from '../lib/data';
import { formatDuration, go, useAsync } from '../lib/util';

export function Overview({ appId, since, rangeLabel }: { appId: string; since: string; rangeLabel: string }) {
  const t = useAsync(() => totals(appId, since), [appId, since]);
  const screens = useAsync(() => screenStats(appId, since), [appId, since]);

  return (
    <>
      <h2>Overview <span className="muted small">{rangeLabel}</span></h2>
      {t.error && <p className="error">{t.error}</p>}
      <div className="kpis">
        <Kpi label="Sessions" value={t.data ? t.data.sessions.toLocaleString() : '…'} />
        <Kpi label="Avg session" value={t.data ? formatDuration(t.data.avgDurationSec) : '…'} />
        <Kpi label="Screens per session" value={t.data ? t.data.avgScreens.toFixed(1) : '…'} />
        <Kpi label="Taps" value={t.data ? t.data.taps.toLocaleString() : '…'} />
      </div>
      {t.data && Object.keys(t.data.platforms).length > 0 && (
        <p className="muted small">
          {Object.entries(t.data.platforms)
            .map(([p, n]) => `${p}: ${n}`)
            .join(' · ')}
        </p>
      )}

      <h3>Screens</h3>
      <p className="muted small">
        Exits are sessions that ended on that screen. A high exit rate on a screen that isn't a natural end point
        usually means people got stuck or lost interest there.
      </p>
      {screens.error && <p className="error">{screens.error}</p>}
      {screens.data && screens.data.length === 0 && <Empty />}
      {screens.data && screens.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Screen</th>
              <th className="num">Views</th>
              <th className="num">Sessions</th>
              <th className="num">Taps</th>
              <th className="num">Exits</th>
              <th className="num">Exit rate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {screens.data.map((s) => {
              const rate = s.sessions ? s.exits / s.sessions : 0;
              return (
                <tr key={s.screen}>
                  <td>{s.screen}</td>
                  <td className="num">{s.views}</td>
                  <td className="num">{s.sessions}</td>
                  <td className="num">{s.taps}</td>
                  <td className="num">{s.exits}</td>
                  <td className="num">
                    <span className={rate > 0.5 ? 'pill warn' : 'pill'}>{Math.round(rate * 100)}%</span>
                  </td>
                  <td className="actions">
                    <a href={`#/heatmaps/${encodeURIComponent(s.screen)}`}>Heatmap</a>
                    <a href={`#/sessions/${encodeURIComponent(s.screen)}`}>Sessions</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

export function Empty() {
  return (
    <div className="card empty">
      <h3>No sessions yet</h3>
      <p>
        Once Recap is on your site or in your app and someone opens it, sessions appear here within about ten seconds.
        Not set up yet? See <a href="#/install">Install</a>. Not seeing anything? Open your site with{' '}
        <code>?recap=on</code>, or turn on <code>debug: true</code> in the app's config, and check the console.
      </p>
      <button onClick={() => go('overview')}>Refresh</button>
    </div>
  );
}
