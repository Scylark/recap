import { useEffect, useMemo, useState } from 'react';
import { LineChart, seriesColor } from '../components/LineChart';
import {
  PROPERTIES,
  SESSION_STARTED,
  breakdown,
  eventNames,
  eventProperties,
  funnel,
  retention,
  trend,
  type EventName,
  type Filters,
  type Interval,
  type Measure,
} from '../lib/analytics';
import { bucketLabel, buckets } from '../lib/time';
import { formatDateTime, formatDuration, go, useAsync } from '../lib/util';

const TABS: { key: string; label: string }[] = [
  { key: 'trends', label: 'Trends' },
  { key: 'funnels', label: 'Funnels' },
  { key: 'retention', label: 'Retention' },
  { key: 'breakdowns', label: 'Breakdowns' },
  { key: 'events', label: 'Events' },
];

const KIND_LABEL: Record<EventName['kind'], string> = {
  session: 'Session',
  screen: 'Screen view',
  tap: 'Button tap',
  custom: 'Custom event',
};

interface Props {
  appId: string;
  since: string;
  days: number;
  tab?: string;
  arg?: string;
}

export function Analytics({ appId, since, days, tab = 'trends', arg }: Props) {
  const names = useAsync(() => eventNames(appId, since), [appId, since]);
  const [filters, setFilters] = useState<Filters>({});
  const platforms = useAsync(() => breakdown(appId, since, { event: SESSION_STARTED, property: 'platform', filters: {} }), [appId, since]);
  const versions = useAsync(() => breakdown(appId, since, { event: SESSION_STARTED, property: 'app_version', filters: {} }), [appId, since]);
  const list = names.data ?? [];

  const setFilter = (k: keyof Filters, v: string) =>
    setFilters((f) => {
      const next = { ...f };
      if (v) next[k] = v;
      else delete next[k];
      return next;
    });

  return (
    <>
      <div className="row space">
        <h2>Analytics</h2>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <a key={t.key} role="tab" aria-selected={t.key === tab} className={t.key === tab ? 'active' : ''} href={`#/analytics/${t.key}`}>
              {t.label}
            </a>
          ))}
        </div>
      </div>

      {tab !== 'events' && (
        <div className="filters">
          <span className="muted small">Filter</span>
          <select aria-label="Platform" value={filters.platform ?? ''} onChange={(e) => setFilter('platform', e.target.value)}>
            <option value="">All platforms</option>
            {(platforms.data ?? []).map((p) => (
              <option key={p.segment} value={p.segment}>
                {p.segment}
              </option>
            ))}
          </select>
          <select aria-label="App version" value={filters.app_version ?? ''} onChange={(e) => setFilter('app_version', e.target.value)}>
            <option value="">All app versions</option>
            {(versions.data ?? []).map((p) => (
              <option key={p.segment} value={p.segment}>
                {p.segment}
              </option>
            ))}
          </select>
        </div>
      )}

      {names.error && <p className="error">{names.error}</p>}
      {names.data && list.length === 0 && (
        <div className="card empty">
          <h3>No events in this period</h3>
          <p>Try a longer time range at the top right, or open your app to send some data.</p>
        </div>
      )}
      {list.length > 0 && tab === 'trends' && <Trends appId={appId} since={since} days={days} names={list} filters={filters} initial={arg} />}
      {list.length > 0 && tab === 'funnels' && <Funnels appId={appId} since={since} names={list} filters={filters} />}
      {list.length > 0 && tab === 'retention' && <Retention appId={appId} since={since} days={days} names={list} filters={filters} />}
      {list.length > 0 && tab === 'breakdowns' && <Breakdowns appId={appId} since={since} names={list} filters={filters} initial={arg} />}
      {list.length > 0 && tab === 'events' && <Events appId={appId} since={since} names={list} selected={arg} />}
    </>
  );
}

// ---------------------------------------------------------------- shared bits

function EventSelect({
  names,
  value,
  onChange,
  allowAll,
  label = 'Event',
}: {
  names: EventName[];
  value: string | null;
  onChange: (v: string | null) => void;
  allowAll?: boolean;
  label?: string;
}) {
  const groups = (['session', 'screen', 'tap', 'custom'] as const).map((k) => [k, names.filter((n) => n.kind === k)] as const);
  return (
    <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowAll && <option value="">All events</option>}
      {groups.map(([k, items]) =>
        items.length ? (
          <optgroup key={k} label={KIND_LABEL[k] + 's'}>
            {items.map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </select>
  );
}

function PropertySelect({ value, onChange, none }: { value: string | null; onChange: (v: string | null) => void; none?: string }) {
  const custom = value?.startsWith('prop:') ? value : null;
  return (
    <>
      <select
        aria-label="Break down by"
        value={custom ? 'custom' : (value ?? '')}
        onChange={(e) => onChange(e.target.value === 'custom' ? 'prop:' : e.target.value || null)}
      >
        {none && <option value="">{none}</option>}
        {PROPERTIES.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom event property…</option>
      </select>
      {custom != null && (
        <input
          aria-label="Custom property name"
          placeholder="property name, e.g. sku"
          defaultValue={custom.slice(5)}
          onBlur={(e) => onChange(`prop:${e.target.value.trim()}`)}
          onKeyDown={(e) => e.key === 'Enter' && onChange(`prop:${(e.target as HTMLInputElement).value.trim()}`)}
        />
      )}
    </>
  );
}

function pct(n: number, d: number): string {
  if (!d) return '–';
  const v = (n / d) * 100;
  return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`;
}

function defaultInterval(days: number): Interval {
  return days <= 2 ? 'hour' : days <= 31 ? 'day' : 'week';
}

// ---------------------------------------------------------------- trends

function Trends({
  appId,
  since,
  days,
  names,
  filters,
  initial,
}: {
  appId: string;
  since: string;
  days: number;
  names: EventName[];
  filters: Filters;
  initial?: string;
}) {
  const [event, setEvent] = useState<string | null>(initial ?? SESSION_STARTED);
  const [measure, setMeasure] = useState<Measure>('total');
  const [interval, setInterval] = useState<Interval>(defaultInterval(days));
  const [by, setBy] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);
  useEffect(() => setInterval(defaultInterval(days)), [days]);
  useEffect(() => {
    if (initial) setEvent(initial);
  }, [initial]);

  const ready = by !== 'prop:';
  const data = useAsync(
    () => (ready ? trend(appId, since, { event, measure, interval, breakdown: by, filters }) : Promise.resolve([])),
    [appId, since, event, measure, interval, by, JSON.stringify(filters)],
  );

  const chart = useMemo(() => {
    const keys = buckets(since, interval);
    const index = new Map(keys.map((k, i) => [k, i]));
    const totals = new Map<string, number>();
    for (const p of data.data ?? []) totals.set(p.segment, (totals.get(p.segment) ?? 0) + p.value);
    const order = [...totals.keys()].sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : totals.get(b)! - totals.get(a)!));
    const series = order.map((name) => ({ name, values: keys.map(() => 0) }));
    for (const p of data.data ?? []) {
      const i = index.get(Date.parse(p.bucket));
      const s = series.find((x) => x.name === p.segment);
      if (i != null && s) s.values[i] = p.value;
    }
    return { labels: keys.map((k) => bucketLabel(k, interval)), series, totals, order };
  }, [data.data, since, interval]);

  const total = [...chart.totals.values()].reduce((a, b) => a + b, 0);
  const what = event ?? 'All events';

  return (
    <>
      <div className="filters">
        <EventSelect names={names} value={event} onChange={setEvent} allowAll />
        <select aria-label="Measure" value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>
          <option value="total">Total events</option>
          <option value="uniques">Unique users</option>
        </select>
        <select aria-label="Interval" value={interval} onChange={(e) => setInterval(e.target.value as Interval)}>
          <option value="hour">Hourly</option>
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </select>
        <PropertySelect value={by} onChange={setBy} none="No breakdown" />
      </div>
      <div className="card chart-card">
        <div className="row space">
          <div>
            <div className="kpi-value">{data.data ? total.toLocaleString() : '…'}</div>
            <div className="kpi-label">
              {measure === 'uniques' ? `Unique users per ${interval}, summed` : 'Total'} · {what}
            </div>
          </div>
          <button className="link" onClick={() => setAsTable((v) => !v)}>
            {asTable ? 'Show chart' : 'Show table'}
          </button>
        </div>
        {data.error && <p className="error">{data.error}</p>}
        {data.data && chart.series.length === 0 && <p className="muted">No matching events in this period.</p>}
        {chart.series.length > 0 &&
          (asTable ? (
            <table>
              <thead>
                <tr>
                  <th>{interval === 'hour' ? 'Hour' : 'Starting'}</th>
                  {chart.series.map((s) => (
                    <th key={s.name} className="num">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chart.labels.map((l, i) => (
                  <tr key={i}>
                    <td>{l}</td>
                    {chart.series.map((s) => (
                      <td key={s.name} className="num">
                        {s.values[i]!.toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <LineChart labels={chart.labels} series={chart.series} />
          ))}
      </div>
      {by && chart.order.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{PROPERTIES.find((p) => p.key === by)?.label ?? by.slice(5)}</th>
              <th className="num">{measure === 'uniques' ? 'Users (summed)' : 'Events'}</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {chart.order.map((name, i) => (
              <tr key={name}>
                <td>
                  <span className="swatch" style={{ background: seriesColor(i, name) }} /> {name}
                </td>
                <td className="num">{chart.totals.get(name)!.toLocaleString()}</td>
                <td className="num">{pct(chart.totals.get(name)!, total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ---------------------------------------------------------------- funnels

function defaultSteps(names: EventName[]): string[] {
  const views = names.filter((n) => n.kind === 'screen').sort((a, b) => b.users - a.users).slice(0, 3);
  const custom = names.filter((n) => n.kind === 'custom').sort((a, b) => b.users - a.users).slice(-1);
  const steps = [SESSION_STARTED, ...views.map((v) => v.name), ...custom.map((c) => c.name)];
  return steps.length >= 2 ? steps : [SESSION_STARTED, names.find((n) => n.name !== SESSION_STARTED)?.name ?? SESSION_STARTED];
}

const WINDOWS = [
  { m: 30, label: '30 minutes' },
  { m: 60, label: '1 hour' },
  { m: 1440, label: '1 day' },
  { m: 10080, label: '7 days' },
  { m: 43200, label: '30 days' },
];

function Funnels({ appId, since, names, filters }: { appId: string; since: string; names: EventName[]; filters: Filters }) {
  const [steps, setSteps] = useState<string[]>(() => defaultSteps(names));
  const [windowMinutes, setWindow] = useState(1440);
  const [by, setBy] = useState<string | null>(null);
  const ready = steps.length >= 2 && by !== 'prop:';
  const data = useAsync(
    () => (ready ? funnel(appId, since, { steps, windowMinutes, breakdown: by, filters }) : Promise.resolve([])),
    [appId, since, steps.join('\u0000'), windowMinutes, by, JSON.stringify(filters)],
  );

  const segments = useMemo(() => {
    const first = (data.data ?? []).filter((r) => r.step === 1);
    return first.sort((a, b) => (a.segment === 'Other' ? 1 : b.segment === 'Other' ? -1 : b.users - a.users)).map((r) => r.segment);
  }, [data.data]);
  const cell = (step: number, seg: string) => data.data?.find((r) => r.step === step && r.segment === seg);
  const usersAt = (step: number) => (data.data ?? []).filter((r) => r.step === step).reduce((a, r) => a + r.users, 0);
  const totalStart = usersAt(1);
  const end = usersAt(steps.length);

  return (
    <>
      <div className="steps">
        {steps.map((s, i) => (
          <div key={i} className="step-edit">
            <span className="step-num">{i + 1}</span>
            <EventSelect names={names} value={s} onChange={(v) => setSteps(steps.map((x, j) => (j === i ? (v ?? x) : x)))} label={`Step ${i + 1}`} />
            {steps.length > 2 && (
              <button className="link" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        {steps.length < 8 && (
          <button onClick={() => setSteps([...steps, names.find((n) => !steps.includes(n.name))?.name ?? steps[steps.length - 1]!])}>+ Add step</button>
        )}
      </div>
      <div className="filters">
        <span className="muted small">Complete within</span>
        <select aria-label="Conversion window" value={windowMinutes} onChange={(e) => setWindow(Number(e.target.value))}>
          {WINDOWS.map((w) => (
            <option key={w.m} value={w.m}>
              {w.label}
            </option>
          ))}
        </select>
        <PropertySelect value={by} onChange={setBy} none="No breakdown" />
      </div>
      {data.error && <p className="error">{data.error}</p>}
      <div className="card">
        <div className="row space">
          <div>
            <div className="kpi-value">{data.data ? pct(end, totalStart) : '…'}</div>
            <div className="kpi-label">
              Overall conversion · {end.toLocaleString()} of {totalStart.toLocaleString()} users
            </div>
          </div>
        </div>
        {data.data && totalStart === 0 && <p className="muted">Nobody did the first step in this period.</p>}
        {totalStart > 0 && (
          <div className="funnel" role="list">
            {steps.map((s, i) => {
              const n = usersAt(i + 1);
              const prev = i === 0 ? n : usersAt(i);
              const avg = (data.data ?? []).filter((r) => r.step === i + 1 && r.avg_seconds != null);
              const avgSec = avg.length ? avg.reduce((a, r) => a + r.avg_seconds! * r.users, 0) / Math.max(1, avg.reduce((a, r) => a + r.users, 0)) : null;
              return (
                <div key={i} className="funnel-step" role="listitem">
                  <div className="funnel-label">
                    <strong>
                      {i + 1}. {s}
                    </strong>
                    <span className="muted small">
                      {n.toLocaleString()} users · {pct(n, totalStart)} of start
                      {i > 0 && <> · {pct(n, prev)} from step {i}</>}
                      {avgSec != null && <> · avg {formatDuration(avgSec)}</>}
                    </span>
                  </div>
                  <div className="funnel-track" title={`${n} users`}>
                    {segments.map((seg, si) => {
                      const c = cell(i + 1, seg)?.users ?? 0;
                      return c ? (
                        <div key={seg} className="funnel-bar" style={{ width: `${(c / totalStart) * 100}%`, background: by ? seriesColor(si, seg) : 'var(--series-1)' }} />
                      ) : null;
                    })}
                  </div>
                  {i > 0 && prev > n && <div className="funnel-drop muted small">{(prev - n).toLocaleString()} dropped off</div>}
                </div>
              );
            })}
          </div>
        )}
        {by && segments.length > 0 && (
          <div className="legend">
            {segments.map((s, i) => (
              <span key={s}>
                <i style={{ background: seriesColor(i, s) }} />
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
      {by && segments.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{PROPERTIES.find((p) => p.key === by)?.label ?? by.slice(5)}</th>
              {steps.map((s, i) => (
                <th key={i} className="num">
                  {i + 1}. {s}
                </th>
              ))}
              <th className="num">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((seg) => {
              const start = cell(1, seg)?.users ?? 0;
              return (
                <tr key={seg}>
                  <td>{seg}</td>
                  {steps.map((_, i) => (
                    <td key={i} className="num">
                      {(cell(i + 1, seg)?.users ?? 0).toLocaleString()}
                    </td>
                  ))}
                  <td className="num">{pct(cell(steps.length, seg)?.users ?? 0, start)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

// ---------------------------------------------------------------- retention

function Retention({ appId, since, days, names, filters }: { appId: string; since: string; days: number; names: EventName[]; filters: Filters }) {
  const [interval, setInterval] = useState<'day' | 'week'>(days >= 30 ? 'week' : 'day');
  const [startEvent, setStart] = useState(SESSION_STARTED);
  const [returnEvent, setReturn] = useState(SESSION_STARTED);
  useEffect(() => setInterval(days >= 30 ? 'week' : 'day'), [days]);
  const data = useAsync(
    () => retention(appId, since, { interval, startEvent, returnEvent, filters }),
    [appId, since, interval, startEvent, returnEvent, JSON.stringify(filters)],
  );

  const grid = useMemo(() => {
    const rows = new Map<string, { cohort: string; size: number; cells: Map<number, number> }>();
    let maxPeriod = 0;
    for (const r of data.data ?? []) {
      const row = rows.get(r.cohort) ?? { cohort: r.cohort, size: r.cohort_size, cells: new Map<number, number>() };
      row.cells.set(r.period, r.users);
      rows.set(r.cohort, row);
      maxPeriod = Math.max(maxPeriod, r.period);
    }
    const list = [...rows.values()].sort((a, b) => Date.parse(a.cohort) - Date.parse(b.cohort));
    const periods = Array.from({ length: Math.max(1, maxPeriod + 1) }, (_, i) => i);
    // Average weighted by cohort size, only counting cohorts old enough to have reached each period.
    const step = interval === 'week' ? 7 * 86_400_000 : 86_400_000;
    const avg = periods.map((p) => {
      const eligible = list.filter((r) => Date.parse(r.cohort) + p * step <= Date.now());
      const size = eligible.reduce((a, r) => a + r.size, 0);
      const users = eligible.reduce((a, r) => a + (r.cells.get(p) ?? 0), 0);
      return { users, size };
    });
    return { list, periods, avg, step };
  }, [data.data, interval]);

  const shade = (f: number) => `color-mix(in srgb, var(--series-1) ${Math.round(8 + f * 82)}%, var(--panel))`;
  const unit = interval === 'week' ? 'Week' : 'Day';

  return (
    <>
      <div className="filters">
        <span className="muted small">Users who did</span>
        <EventSelect names={names} value={startEvent} onChange={(v) => setStart(v ?? SESSION_STARTED)} label="First event" />
        <span className="muted small">then came back and did</span>
        <EventSelect names={names} value={returnEvent} onChange={(v) => setReturn(v ?? SESSION_STARTED)} label="Return event" />
        <select aria-label="Interval" value={interval} onChange={(e) => setInterval(e.target.value as 'day' | 'week')}>
          <option value="day">By day</option>
          <option value="week">By week</option>
        </select>
      </div>
      <p className="muted small">
        Each row is everyone whose first <strong>{startEvent}</strong> in this period fell on that {unit.toLowerCase()}. Columns show the share who
        did <strong>{returnEvent}</strong> again {interval === 'week' ? 'weeks' : 'days'} later. Users are your own ids from <code>setUserId()</code>, or the
        SDK's anonymous install id. Pick a longer time range for more cohorts.
      </p>
      {data.error && <p className="error">{data.error}</p>}
      {data.data && grid.list.length === 0 && <p className="muted">No users did that event in this period.</p>}
      {grid.list.length > 0 && (
        <div className="scroll-x">
          <table className="retention">
            <thead>
              <tr>
                <th>Cohort</th>
                <th className="num">Users</th>
                {grid.periods.map((p) => (
                  <th key={p} className="num">
                    {unit} {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="avg">
                <td>Average</td>
                <td className="num">{grid.list.reduce((a, r) => a + r.size, 0).toLocaleString()}</td>
                {grid.avg.map((a, p) => (
                  <td key={p} className="num">
                    {a.size ? pct(a.users, a.size) : ''}
                  </td>
                ))}
              </tr>
              {grid.list.map((r) => (
                <tr key={r.cohort}>
                  <td>{new Date(r.cohort).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td>
                  <td className="num">{r.size.toLocaleString()}</td>
                  {grid.periods.map((p) => {
                    const reached = Date.parse(r.cohort) + p * grid.step <= Date.now();
                    const n = r.cells.get(p) ?? 0;
                    const f = r.size ? n / r.size : 0;
                    return (
                      <td
                        key={p}
                        className={`num cell${f > 0.55 ? ' strong' : ''}`}
                        style={reached ? { background: shade(f) } : undefined}
                        title={reached ? `${n} of ${r.size} users` : 'Not reached yet'}
                      >
                        {reached ? pct(n, r.size) : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- breakdowns

function Breakdowns({ appId, since, names, filters, initial }: { appId: string; since: string; names: EventName[]; filters: Filters; initial?: string }) {
  const [event, setEvent] = useState<string | null>(initial ?? SESSION_STARTED);
  const [by, setBy] = useState<string | null>('platform');
  useEffect(() => {
    if (initial) setEvent(initial);
  }, [initial]);
  const property = by ?? 'platform';
  const data = useAsync(
    () => (property === 'prop:' ? Promise.resolve([]) : breakdown(appId, since, { event, property, filters })),
    [appId, since, event, property, JSON.stringify(filters)],
  );
  const total = (data.data ?? []).reduce((a, r) => a + r.events, 0);
  const max = Math.max(1, ...(data.data ?? []).map((r) => r.events));

  return (
    <>
      <div className="filters">
        <EventSelect names={names} value={event} onChange={setEvent} allowAll />
        <span className="muted small">by</span>
        <PropertySelect value={by} onChange={setBy} />
      </div>
      {data.error && <p className="error">{data.error}</p>}
      {data.data && data.data.length === 0 && <p className="muted">No matching events in this period.</p>}
      {data.data && data.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{PROPERTIES.find((p) => p.key === property)?.label ?? property.slice(5)}</th>
              <th className="bar-col">Events</th>
              <th className="num">Events</th>
              <th className="num">Users</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((r) => (
              <tr key={r.segment}>
                <td>{r.segment}</td>
                <td className="bar-col">
                  <div className="hbar" style={{ width: `${(r.events / max) * 100}%` }} />
                </td>
                <td className="num">{r.events.toLocaleString()}</td>
                <td className="num">{r.users.toLocaleString()}</td>
                <td className="num">{pct(r.events, total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ---------------------------------------------------------------- events

function Events({ appId, since, names, selected }: { appId: string; since: string; names: EventName[]; selected?: string }) {
  const [kind, setKind] = useState<string>('');
  const shown = names.filter((n) => !kind || n.kind === kind);
  const props = useAsync(() => (selected ? eventProperties(appId, since, selected) : Promise.resolve([])), [appId, since, selected]);
  const keys = [...new Set((props.data ?? []).map((p) => p.key))];
  const customCount = names.filter((n) => n.kind === 'custom').length;

  return (
    <div className="detail">
      <div>
        <div className="filters">
          <select aria-label="Event type" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All event types</option>
            {(Object.keys(KIND_LABEL) as EventName['kind'][]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}s
              </option>
            ))}
          </select>
          <span className="muted small">{shown.length} events</span>
        </div>
        <table className="clickable">
          <thead>
            <tr>
              <th>Event</th>
              <th>Type</th>
              <th className="num">Count</th>
              <th className="num">Users</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((n) => (
              <tr key={n.name} onClick={() => go(`analytics/events/${encodeURIComponent(n.name)}`)} className={n.name === selected ? 'selected' : ''}>
                <td>{n.name}</td>
                <td className="muted">{KIND_LABEL[n.kind]}</td>
                <td className="num">{n.events.toLocaleString()}</td>
                <td className="num">{n.users.toLocaleString()}</td>
                <td className="muted">{formatDateTime(n.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {customCount === 0 && (
          <p className="muted small">
            No custom events yet. Send your own with <code>recap.track('order_completed', {'{'} value: 89 {'}'})</code> and they show up here, ready for
            trends and funnels.
          </p>
        )}
      </div>
      <div className="side card">
        {!selected && <p className="muted">Pick an event to see its properties and jump to a chart.</p>}
        {selected && (
          <>
            <h3 style={{ marginTop: 0 }}>{selected}</h3>
            <div className="row">
              <a href={`#/analytics/trends/${encodeURIComponent(selected)}`}>Trend</a>
              <a href={`#/analytics/breakdowns/${encodeURIComponent(selected)}`}>Breakdown</a>
            </div>
            {props.error && <p className="error">{props.error}</p>}
            {props.data && keys.length === 0 && <p className="muted small">No extra properties on this event.</p>}
            {keys.map((k) => (
              <div key={k} className="prop">
                <div className="muted small">{k}</div>
                <ul>
                  {props.data!
                    .filter((p) => p.key === k)
                    .map((p) => (
                      <li key={p.value}>
                        <span>{p.value}</span> <span className="muted">{p.events.toLocaleString()}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
