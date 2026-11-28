import { useEffect, useMemo, useState } from 'react';
import { Heatmap } from '../components/Heatmap';
import { PageHeatmap } from '../components/PageHeatmap';
import { pageSnapshotFor, screenActivity, screenStats, screenshotFor } from '../lib/data';
import {
  DEVICE_CLASSES,
  type DeviceClass,
  busiestDevice,
  countByDevice,
  deviceClass,
  isDeadTap,
  layoutViewport,
  rageTaps,
  scrollReach,
  toTap,
  topTargets,
} from '../lib/heatmap';
import { go, useAsync } from '../lib/util';
import { Empty } from './Overview';

export function Heatmaps({ appId, since, screen, device: deviceArg }: { appId: string; since: string; screen?: string; device?: string }) {
  const screens = useAsync(() => screenStats(appId, since), [appId, since]);
  const current = screen ?? screens.data?.[0]?.screen;
  const activity = useAsync(
    () => (current ? screenActivity(appId, current, since) : Promise.resolve(null)),
    [appId, since, current],
  );
  // The device size is in the address (heatmaps/<screen>/<device>), so a shared link opens the same view.
  const device = DEVICE_CLASSES.some((d) => d.key === deviceArg) ? (deviceArg as DeviceClass) : null;
  const setDevice = (d: DeviceClass) => current && go(`heatmaps/${encodeURIComponent(current)}/${d}`);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    setNames(new Map());
    setHighlight(null);
  }, [appId, current]);

  const taps = useMemo(() => (activity.data?.taps ?? []).map(toTap), [activity.data]);
  const web = taps.length ? taps.some((t) => t.web) : [...(activity.data?.sessions.values() ?? [])].some((s) => s.platform === 'web');
  const counts = countByDevice(taps);
  const shown: DeviceClass = device ?? busiestDevice(taps);
  const here = useMemo(() => taps.filter((t) => t.device === shown), [taps, shown]);
  const viewport = layoutViewport(here, shown);

  // Visits to this screen from this size of device, and how far down each one scrolled.
  const visits = useMemo(() => {
    const a = activity.data;
    if (!a) return [];
    return a.views
      .map((v) => ({ ...v, s: a.sessions.get(v.sessionId) }))
      .filter((v) => v.s && deviceClass(v.s.screen_width) === shown);
  }, [activity.data, shown]);
  const reach = useMemo(
    () => scrollReach(visits.map((v) => v.sessionId), activity.data?.maxDepth ?? new Map()),
    [visits, activity.data],
  );
  const rage = useMemo(() => rageTaps(here), [here]);
  const dead = useMemo(() => here.filter(isDeadTap), [here]);
  const targets = useMemo(() => topTargets(here, (sel) => names.get(sel) ?? null), [here, names]);

  // The page behind the taps: the newest recorded visit at this size.
  const recorded = useMemo(
    () =>
      visits
        .filter((v) => v.s!.platform === 'web' && v.s!.has_recording !== false)
        .map((v) => ({ sessionId: v.sessionId, tMs: v.tMs, startedAt: v.s!.started_at })),
    [visits],
  );
  const snapshotKey = recorded.slice(0, 8).map((v) => `${v.sessionId}:${v.tMs}`).join(',');
  const snapshot = useAsync(
    () => (web && recorded.length ? pageSnapshotFor(recorded) : Promise.resolve(null)),
    [web, snapshotKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const shot = useAsync(
    () => (current && !web ? screenshotFor(appId, current) : Promise.resolve(null)),
    [appId, current, web],
  );

  if (screens.data && screens.data.length === 0) return <Empty />;

  const visitCount = new Set(visits.map((v) => v.sessionId)).size;
  const half = reach.find((r) => r.depth === 50);
  const loading = activity.loading || (!activity.data && !activity.error);

  return (
    <>
      <h2>Heatmaps</h2>
      <div className="filters">
        <select
          aria-label="Screen"
          value={current ?? ''}
          onChange={(e) => go(`heatmaps/${encodeURIComponent(e.target.value)}${device ? `/${device}` : ''}`)}
        >
          {(screens.data ?? []).map((s) => (
            <option key={s.screen} value={s.screen}>
              {s.screen} · {s.views.toLocaleString()} views, {s.taps.toLocaleString()} taps
            </option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="Device size">
          {DEVICE_CLASSES.map((d) => (
            <button
              key={d.key}
              className={shown === d.key ? 'on' : ''}
              aria-pressed={shown === d.key}
              disabled={!counts[d.key] && shown !== d.key}
              onClick={() => setDevice(d.key)}
            >
              {d.label} {counts[d.key] ? `(${counts[d.key].toLocaleString()})` : ''}
            </button>
          ))}
        </div>
      </div>
      {activity.error && <p className="error">{activity.error}</p>}

      <div className="kpis heat-kpis">
        <Kpi label="Visits" value={loading ? '…' : visitCount.toLocaleString()} />
        <Kpi label="Taps" value={loading ? '…' : here.length.toLocaleString()} />
        {web && <Kpi label="Scrolled halfway" value={loading || !visitCount ? '–' : `${Math.round((half?.share ?? 0) * 100)}%`} />}
        <Kpi label="Rage taps" value={loading ? '…' : rage.length.toLocaleString()} hint="Three or more quick taps on one spot in one visit: something that didn't respond" />
        {web && (
          <Kpi
            label="Dead taps"
            value={loading ? '…' : here.length ? `${Math.round((dead.length / here.length) * 100)}%` : '–'}
            hint="Taps on things that aren't links, buttons or form fields: people expected them to do something"
          />
        )}
      </div>

      <div className="pair heat-pair">
        <div className={web ? 'heat-main' : ''} style={web ? { width: `min(100%, ${Math.round(snapshot.data?.width || viewport.width)}px)` } : undefined}>
          {web ? (
            <PageHeatmap
              taps={here}
              snapshot={snapshot.data ?? null}
              viewport={viewport}
              reach={reach}
              rage={rage}
              onNames={setNames}
              highlight={highlight}
            />
          ) : (
            <Heatmap
              points={here}
              width={300}
              backgroundUrl={shot.data?.image ?? null}
              {...(shot.data?.width && shot.data.height ? { aspect: shot.data.height / shot.data.width } : {})}
            />
          )}
          <p className="muted small">
            {loading ? 'Loading…' : `${here.length.toLocaleString()} taps from ${visitCount.toLocaleString()} visits in this period.`}{' '}
            {activity.data?.capped && 'Only the newest 5,000 taps are shown. '}
            {web
              ? 'Each tap is where it landed on the page, at this device size; taps on a bar that stays on screen are drawn on the bar.'
              : 'Positions are shares of the screen, so they line up across phone sizes.'}
          </p>
          {web && !snapshot.loading && !snapshot.data && (
            <p className="muted small">
              No recorded visit of this screen at this size yet, so the taps are drawn on a blank page. Turn on{' '}
              <code>recordings</code> in the web script and the newest recorded visit is drawn here.
            </p>
          )}
          {!web && !shot.loading && !shot.data && (
            <p className="muted small">
              Want the screen behind the taps? Turn on <code>screenshots</code> in the SDK config and open this screen
              once on a test phone.
            </p>
          )}
        </div>
        <div className="pair-side">
          <h3>Most tapped</h3>
          {!loading && targets.length === 0 && (
            <p className="muted small">
              {web ? (
                <>
                  No taps here yet. Give key buttons a <code>data-ut-label</code> to see them by name.
                </>
              ) : (
                <>
                  No labelled taps on this screen yet. Wrap key buttons with <code>recapPress('Name', handler)</code> so
                  they show up here by name.
                </>
              )}
            </p>
          )}
          {targets.length > 0 && (
            <table className="clickable">
              <thead>
                <tr>
                  <th>Element</th>
                  <th className="num">Taps</th>
                  <th className="num">Of visits</th>
                </tr>
              </thead>
              <tbody>
                {targets.slice(0, 15).map((t) => (
                  <tr
                    key={t.key}
                    className={highlight === t.key ? 'on' : ''}
                    onMouseEnter={() => setHighlight(t.key)}
                    onMouseLeave={() => setHighlight(null)}
                    onClick={() => setHighlight((h) => (h === t.key ? null : t.key))}
                  >
                    <td title={t.key.startsWith('sel:') ? t.key.slice(4) : undefined}>
                      {t.name} {t.dead && <span className="pill warn" title="Not a link, button or form field">dead</span>}
                    </td>
                    <td className="num">{t.count.toLocaleString()}</td>
                    <td className="num muted" title="Share of visits that tapped it">
                      {visitCount ? `${Math.round((t.visits / visitCount) * 100)}%` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {web && reach.length > 0 && visitCount > 0 && (
            <>
              <h3>How far down</h3>
              <table>
                <tbody>
                  {reach.map((r) => (
                    <tr key={r.depth}>
                      <td>{r.depth === 100 ? 'Reached the end' : `Scrolled ${r.depth}% down`}</td>
                      <td className="num">{Math.round(r.share * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi" title={hint}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
