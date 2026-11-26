import { Heatmap } from '../components/Heatmap';
import { screenStats, tapsOnScreen, topLabels } from '../lib/data';
import { go, useAsync } from '../lib/util';
import { Empty } from './Overview';

export function Heatmaps({ appId, since, screen }: { appId: string; since: string; screen?: string }) {
  const screens = useAsync(() => screenStats(appId, since), [appId, since]);
  const current = screen ?? screens.data?.[0]?.screen;
  const taps = useAsync(
    () => (current ? tapsOnScreen(appId, current, since) : Promise.resolve([])),
    [appId, since, current],
  );
  const labels = useAsync(
    () => (current ? topLabels(appId, current, since) : Promise.resolve([])),
    [appId, since, current],
  );

  if (screens.data && screens.data.length === 0) return <Empty />;

  return (
    <>
      <h2>Heatmaps</h2>
      <div className="filters">
        <select value={current ?? ''} onChange={(e) => go(`heatmaps/${encodeURIComponent(e.target.value)}`)}>
          {(screens.data ?? []).map((s) => (
            <option key={s.screen} value={s.screen}>
              {s.screen} ({s.taps} taps)
            </option>
          ))}
        </select>
      </div>
      {taps.error && <p className="error">{taps.error}</p>}
      <div className="pair">
        <div>
          <Heatmap points={taps.data ?? []} width={300} />
          <p className="muted small">
            {taps.data ? `${taps.data.length.toLocaleString()} taps` : 'Loading…'} across all sessions in this period.
            Positions are relative to the screen, so they line up across phone sizes.
          </p>
        </div>
        <div className="pair-side">
          <h3>Most tapped</h3>
          {labels.data && labels.data.length === 0 && (
            <p className="muted small">
              No labelled taps on this screen yet. Wrap key buttons with <code>recapPress('Name', handler)</code> so
              they show up here by name.
            </p>
          )}
          {labels.data && labels.data.length > 0 && (
            <table>
              <tbody>
                {labels.data.slice(0, 15).map((l) => (
                  <tr key={l.label}>
                    <td>{l.label}</td>
                    <td className="num">{l.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
