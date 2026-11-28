import { useEffect, useMemo, useState } from 'react';
import { Heatmap } from '../components/Heatmap';
import { type PageElement, PageHeatmap } from '../components/PageHeatmap';
import { eventNames } from '../lib/analytics';
import { pageSnapshotFor, screenActivity, screenStats, screenshotFor, sessionsWithEvent } from '../lib/data';
import {
  DEVICE_CLASSES,
  type DeviceClass,
  busiestDevice,
  countByDevice,
  deviceClass,
  isDeadTap,
  layoutViewport,
  aboveFoldShare,
  rageTaps,
  scrollReach,
  targetKey,
  targetsCsv,
  toTap,
  topTargets,
} from '../lib/heatmap';
import { go, useAsync, useKeyedAsync } from '../lib/util';
import { Empty } from './Overview';

export function Heatmaps({ appId, since, screen, device: deviceArg }: { appId: string; since: string; screen?: string; device?: string }) {
  const screens = useAsync(() => screenStats(appId, since), [appId, since]);
  const current = screen ?? screens.data?.[0]?.screen;
  const activity = useKeyedAsync(
    () => (current ? screenActivity(appId, current, since) : Promise.resolve(null)),
    [appId, since, current ?? null],
  );
  // The device size is in the address (heatmaps/<screen>/<device>), so a shared link opens the same view.
  const device = DEVICE_CLASSES.some((d) => d.key === deviceArg) ? (deviceArg as DeviceClass) : null;
  const setDevice = (d: DeviceClass) => current && go(`heatmaps/${encodeURIComponent(current)}/${d}`);
  // Tapped elements as the drawn page shows them: their names, and whether they act like controls.
  const [elements, setElements] = useState<Map<string, PageElement>>(new Map());
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    setElements(new Map());
    setHighlight(null);
  }, [appId, current, deviceArg]);

  // A segment: only the visits that did (or didn't) send one of the app's own events, e.g. signed_up.
  const [segment, setSegment] = useState<{ name: string; did: boolean } | null>(null);
  useEffect(() => setSegment(null), [appId]);
  const custom = useAsync(() => eventNames(appId, since).then((l) => l.filter((e) => e.kind === 'custom')), [appId, since]);
  const segmentSessions = useKeyedAsync(
    () => (segment ? sessionsWithEvent(appId, segment.name, since) : Promise.resolve(null)),
    [appId, since, segment?.name ?? null],
  );
  // While a segment loads, nothing is shown as if it were in it.
  const inSegment = useMemo(() => {
    if (!segment) return () => true;
    const set = segmentSessions.data?.sessions;
    if (!set) return () => false;
    return (sessionId: string) => set.has(sessionId) === segment.did;
  }, [segment, segmentSessions.data]);

  const allTaps = useMemo(() => (activity.data?.taps ?? []).map(toTap), [activity.data]);
  const taps = useMemo(() => allTaps.filter((t) => inSegment(t.sessionId)), [allTaps, inSegment]);
  const web = allTaps.length ? allTaps.some((t) => t.web) : [...(activity.data?.sessions.values() ?? [])].some((s) => s.platform === 'web');
  // A size is there to look at when it has taps or visits (a size can be scrolled and never tapped).
  const counts = countByDevice(taps);
  const visitsBy = useMemo(() => {
    const out: Record<DeviceClass, number> = { phone: 0, tablet: 0, desktop: 0 };
    const a = activity.data;
    if (a) for (const v of a.views) {
      const s = a.sessions.get(v.sessionId);
      if (s && inSegment(v.sessionId)) out[deviceClass(s.screen_width)]++;
    }
    return out;
  }, [activity.data, inSegment]);
  const shown: DeviceClass = device ?? busiestDevice(taps);
  const here = useMemo(() => taps.filter((t) => t.device === shown), [taps, shown]);
  const viewport = layoutViewport(here, shown);

  // Visits to this screen from this size of device (all of them, for the page behind the taps), and
  // the ones in the segment, with how far down each one scrolled.
  const sizeVisits = useMemo(() => {
    const a = activity.data;
    if (!a) return [];
    return a.views.map((v) => ({ ...v, s: a.sessions.get(v.sessionId)! })).filter((v) => v.s && deviceClass(v.s.screen_width) === shown);
  }, [activity.data, shown]);
  const visits = useMemo(() => sizeVisits.filter((v) => inSegment(v.sessionId)), [sizeVisits, inSegment]);
  const reach = useMemo(
    () => scrollReach(visits.map((v) => v.sessionId), activity.data?.maxDepth ?? new Map()),
    [visits, activity.data],
  );
  const rage = useMemo(() => rageTaps(here), [here]);
  const interactive = useMemo(() => (sel: string) => elements.get(sel)?.interactive, [elements]);
  const dead = useMemo(() => here.filter((t) => isDeadTap(t, interactive)), [here, interactive]);
  const targets = useMemo(() => topTargets(here, (sel) => elements.get(sel)?.name ?? null, interactive), [here, elements, interactive]);
  // Where the rage taps were, by element.
  const rageBy = useMemo(() => {
    const by = new Map<string, number>();
    for (const g of rage) {
      const k = targetKey(g[0]!);
      if (k) by.set(k, (by.get(k) ?? 0) + 1);
    }
    return targets.filter((t) => by.has(t.key)).map((t) => ({ ...t, rage: by.get(t.key)! })).sort((a, b) => b.rage - a.rage);
  }, [rage, targets]);

  // The page behind the taps: a recorded visit at this size, nearest the taps' window width, newest
  // first. Chosen from every visit at this size, so switching segment doesn't change the page.
  const recorded = useMemo(
    () =>
      sizeVisits
        .filter((v) => v.s.platform === 'web' && v.s.has_recording !== false)
        .map((v) => ({ sessionId: v.sessionId, tMs: v.tMs, startedAt: v.s.started_at, width: v.s.screen_width })),
    [sizeVisits],
  );
  const recordedKey = `${recorded.length}:${recorded.slice(0, 8).map((v) => `${v.sessionId}:${v.tMs}`).join(',')}`;
  // Which recorded visit to draw, and the next one on request (one may have had a menu open).
  const [snapFrom, setSnapFrom] = useState(0);
  useEffect(() => setSnapFrom(0), [recordedKey, viewport.width]);
  const snapshot = useKeyedAsync(
    () => (web && recorded.length ? pageSnapshotFor(recorded, snapFrom, viewport.width) : Promise.resolve(null)),
    [web, recordedKey, snapFrom, viewport.width],
  );
  const shot = useKeyedAsync(
    () => (current && !web ? screenshotFor(appId, current) : Promise.resolve(null)),
    [appId, current ?? null, web],
  );

  if (screens.data && screens.data.length === 0) return <Empty />;

  const visitCount = new Set(visits.map((v) => v.sessionId)).size;
  const fold = aboveFoldShare(here);
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
              disabled={!counts[d.key] && !visitsBy[d.key] && shown !== d.key}
              onClick={() => setDevice(d.key)}
            >
              {d.label} {counts[d.key] ? `(${counts[d.key].toLocaleString()})` : ''}
            </button>
          ))}
        </div>
        {(custom.data?.length ?? 0) > 0 && (
          <select
            aria-label="Which visits"
            value={segment ? `${segment.did ? 'did' : 'not'}:${segment.name}` : ''}
            onChange={(e) => {
              const v = e.target.value;
              setSegment(v ? { did: v.startsWith('did:'), name: v.slice(4) } : null);
            }}
          >
            <option value="">All visits</option>
            {custom.data!.map((ev) => (
              <option key={`did:${ev.name}`} value={`did:${ev.name}`}>
                Visits with {ev.name}
              </option>
            ))}
            {custom.data!.map((ev) => (
              <option key={`not:${ev.name}`} value={`not:${ev.name}`}>
                Visits without {ev.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {activity.error && <p className="error">{activity.error}</p>}
      {segmentSessions.error && <p className="error">{segmentSessions.error}</p>}

      <div className="kpis heat-kpis">
        <Kpi label="Visits" value={loading ? '…' : visitCount.toLocaleString()} />
        <Kpi label="Taps" value={loading ? '…' : here.length.toLocaleString()} />
        {web && <Kpi label="Scrolled halfway" value={loading || !visitCount ? '–' : `${Math.round((half?.share ?? 0) * 100)}%`} />}
        {web && (
          <Kpi
            label="Taps above the fold"
            value={loading || fold === null ? '–' : `${Math.round(fold * 100)}%`}
            hint="Taps made without scrolling, in the window they were made in"
          />
        )}
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
              onElements={setElements}
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
            {activity.data?.capped && `This period has more than the page reads, so the map covers ${new Date(activity.data.from).toLocaleString()} onwards. `}
            {segmentSessions.data?.capped && 'The segment read its first 50,000 events, so a few visits may be missing from it. '}
            {!loading && visitCount > 0 && visitCount < 30 && (
              <strong className="warn-text">Only {visitCount} visits: a pattern this small can be chance. </strong>
            )}
            {web
              ? 'Each tap is where it landed on the page, at this device size; taps on a bar that stays on screen are drawn on the bar.'
              : 'Positions are shares of the screen, so they line up across phone sizes.'}
          </p>
          {web && snapshot.data && (
            <p className="muted small">
              Page from a visit on {new Date(snapshot.data.startedAt).toLocaleString()}, in a {snapshot.data.width}×{snapshot.data.height}{' '}
              window. <a href={`#/session/${encodeURIComponent(snapshot.data.sessionId)}`}>Watch that visit</a>
              {recorded.length > 1 && (
                <>
                  {' · '}
                  <button className="link" onClick={() => setSnapFrom(snapshot.data!.index + 1)}>
                    Try another recording
                  </button>
                </>
              )}
            </p>
          )}
          {web && !snapshot.loading && !snapshot.data && snapFrom > 0 && (
            <p className="muted small">
              No more recordings at this size. <button className="link" onClick={() => setSnapFrom(0)}>Back to the newest</button>
            </p>
          )}
          {web && !snapshot.loading && !snapshot.data && snapFrom === 0 && recorded.length === 0 && (
            <p className="muted small">
              No recorded visit of this screen at this size yet, so the taps are drawn on a blank page. Turn on{' '}
              <code>recordings</code> in the web script and a recorded visit is drawn here.
            </p>
          )}
          {web && !snapshot.loading && !snapshot.data && snapFrom === 0 && recorded.length > 0 && (
            <p className="muted small">
              The recorded visits reached this screen without loading a page, as a single-page app does, so none
              has a picture of it of its own and the taps are drawn on a blank page. A visit that opens this screen
              directly (by its address, or a reload) gives it one.
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
          <div className="row space side-head">
            <h3>Most tapped</h3>
            {targets.length > 0 && (
              <button
                className="link"
                onClick={() => {
                  const blob = new Blob([targetsCsv(targets, visitCount)], { type: 'text/csv' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `recap-taps-${(current ?? 'screen').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'home'}-${shown}.csv`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                }}
              >
                Download CSV
              </button>
            )}
          </div>
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
                    tabIndex={0}
                    aria-label={`${t.name}: ${t.count} taps. Show on the map`}
                    onMouseEnter={() => setHighlight(t.key)}
                    onMouseLeave={() => setHighlight(null)}
                    onFocus={() => setHighlight(t.key)}
                    onBlur={() => setHighlight(null)}
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
          {rageBy.length > 0 && (
            <>
              <h3>Rage taps</h3>
              <table className="clickable">
                <tbody>
                  {rageBy.slice(0, 8).map((t) => (
                    <tr
                      key={t.key}
                      tabIndex={0}
                      className={highlight === t.key ? 'on' : ''}
                      onMouseEnter={() => setHighlight(t.key)}
                      onMouseLeave={() => setHighlight(null)}
                      onFocus={() => setHighlight(t.key)}
                      onBlur={() => setHighlight(null)}
                    >
                      <td>{t.name}</td>
                      <td className="num">{t.rage === 1 ? '1 visit' : `${t.rage} times`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
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
