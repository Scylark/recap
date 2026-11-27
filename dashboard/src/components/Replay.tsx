import { useEffect, useMemo, useRef, useState } from 'react';
import type { Frame, Screenshot } from '../lib/data';
import type { EventRow } from '../lib/types';

/**
 * Plays a session back like a screen recording, built from the events Recap already has:
 * the picture of each screen, taps rippling in where and when they happened, scroll depth,
 * screen changes, custom events and time spent away from the app.
 */

const RIPPLE_MS = 900;
const IDLE_GAP_MS = 2500;
const SPEEDS = [1, 2, 4] as const;

interface Props {
  events: EventRow[];
  durationMs: number;
  pictures: Record<string, Screenshot>;
  /** Recording frames, when the app sends them. Otherwise each screen's picture is shown. */
  frames?: Frame[];
  aspect?: number;
  describe: (e: EventRow) => string;
}

interface Tap {
  t: number;
  nx: number;
  ny: number;
  label: string | null;
  rage: boolean;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function Replay({ events, durationMs, pictures, frames = [], aspect = 2.16, describe }: Props) {
  const sorted = useMemo(() => [...events].sort((a, b) => a.t_ms - b.t_ms), [events]);
  const end = Math.max(durationMs, (sorted[sorted.length - 1]?.t_ms ?? 0) + 1500, 1000);

  const taps: Tap[] = useMemo(() => {
    const list = sorted.filter((e) => e.type === 'tap');
    return list.map((e, i) => {
      const nx = Number(e.data.nx ?? 0);
      const ny = Number(e.data.ny ?? 0);
      // Three or more taps within a second in roughly the same spot reads as frustration.
      const near = list.filter(
        (o, j) => j !== i && Math.abs(o.t_ms - e.t_ms) < 1000 && Math.hypot(Number(o.data.nx ?? 0) - nx, Number(o.data.ny ?? 0) - ny) < 0.08,
      );
      return { t: e.t_ms, nx, ny, label: (e.data.label as string) ?? null, rage: near.length >= 2 };
    });
  }, [sorted]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [skipIdle, setSkipIdle] = useState(true);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const tRef = useRef(0);
  tRef.current = t;

  useEffect(() => {
    if (!playing) return;
    const step = (now: number) => {
      const prev = last.current ?? now;
      last.current = now;
      let next = tRef.current + (now - prev) * speed;
      if (skipIdle) {
        const upcoming = sorted.find((e) => e.t_ms > tRef.current);
        if (upcoming && upcoming.t_ms - next > IDLE_GAP_MS) next = upcoming.t_ms - 600;
      }
      if (next >= end) {
        setT(end);
        setPlaying(false);
        return;
      }
      setT(next);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      last.current = null;
    };
  }, [playing, speed, skipIdle, sorted, end]);

  // What the phone looks like at time t.
  const past = sorted.filter((e) => e.t_ms <= t);
  const screen = [...past].reverse().find((e) => e.screen)?.screen ?? sorted.find((e) => e.screen)?.screen ?? 'Unknown screen';
  const screenSince = [...past].reverse().find((e) => e.type === 'screen')?.t_ms ?? 0;
  const scroll = [...past].reverse().find((e) => e.type === 'scroll' && e.t_ms >= screenSince && e.screen === screen);
  const appState = [...past].reverse().find((e) => e.type === 'app_state');
  const away = appState?.data.state === 'background';
  const ripples = taps.filter((p) => p.t <= t && t - p.t < RIPPLE_MS);
  const toast = [...past].reverse().find((e) => e.type === 'custom' && t - e.t_ms < 1800);
  const current = [...past].reverse().find((e) => e.type !== 'screen') ?? past[past.length - 1];
  const recorded = frames.length > 0;
  let frame: Frame | undefined;
  if (recorded) {
    // Latest frame at or before t (frames are sorted); before the first one, show the first.
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid]!.t_ms <= t) lo = mid;
      else hi = mid - 1;
    }
    frame = frames[lo];
  }
  const hidden = recorded && frame?.image === null;
  const picture = recorded ? (frame?.image ? { image: frame.image, width: null, height: null } : pictures[screen]) : pictures[screen];
  const width = 280;
  const height = Math.round(width * (picture?.width && picture.height ? picture.height / picture.width : aspect));

  const toggle = () => {
    if (!playing && t >= end) setT(0);
    setPlaying((p) => !p);
  };

  // Keep the active row in the event list in view while playing.
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!playing) return;
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [current?.id, playing]);

  return (
    <div className="replay">
      <div className="replay-stage">
        <div className="phone replay-phone" style={{ width, height }}>
          {picture ? (
            <img src={picture.image} alt={`${screen} screen`} className="phone-bg replay-bg" />
          ) : (
            <div className="phone-grid replay-missing">
              <span>{screen}</span>
              <small>No picture of this screen yet</small>
            </div>
          )}
          {hidden && (
            <div className="replay-hidden">
              <span>🔒</span>
              Hidden for privacy
              <small>Typing or a private screen</small>
            </div>
          )}
          <div className="replay-screen-name">{screen}</div>
          <div className={`replay-mode${recorded ? ' rec' : ''}`}>{recorded ? '● Recording' : 'Screen picture'}</div>
          {scroll && (
            <div className="replay-scroll" title={`Scrolled ${String(scroll.data.depth)}%`}>
              <i style={{ height: `${Math.min(100, Number(scroll.data.depth))}%` }} />
            </div>
          )}
          {ripples.map((p) => {
            const age = (t - p.t) / RIPPLE_MS;
            return (
              <span
                key={p.t + ':' + p.nx}
                className={`ripple${p.rage ? ' rage' : ''}`}
                style={{
                  left: `${p.nx * 100}%`,
                  top: `${p.ny * 100}%`,
                  opacity: 1 - age,
                  transform: `translate(-50%, -50%) scale(${0.6 + age * 1.2})`,
                }}
              />
            );
          })}
          {ripples.length > 0 && ripples[ripples.length - 1]!.label && (
            <div className="replay-label">{ripples[ripples.length - 1]!.label}</div>
          )}
          {toast && <div className="replay-toast">★ {String(toast.data.name)}</div>}
          {away && <div className="replay-away">Left the app</div>}
        </div>
      </div>

      <div className="replay-side">
        <div className="replay-controls">
          <button className="primary replay-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? '❚❚ Pause' : t >= end ? '↺ Replay' : '▶ Play'}
          </button>
          <span className="mono small">
            {fmt(t)} / {fmt(end)}
          </span>
          <div className="seg" role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
          <label className="small">
            <input type="checkbox" checked={skipIdle} onChange={(e) => setSkipIdle(e.target.checked)} /> Skip pauses
          </label>
        </div>

        <div className="scrubber">
          <input
            type="range"
            min={0}
            max={end}
            step={50}
            value={t}
            aria-label="Position in session"
            onChange={(e) => {
              setT(Number(e.target.value));
              setPlaying(false);
            }}
          />
          <div className="scrubber-marks" aria-hidden>
            {sorted
              .filter((e) => e.type === 'screen' || e.type === 'tap' || e.type === 'custom')
              .map((e) => (
                <i
                  key={e.id}
                  className={`mark mark-${e.type}${e.type === 'tap' && taps.find((p) => p.t === e.t_ms)?.rage ? ' mark-rage' : ''}`}
                  style={{ left: `${(e.t_ms / end) * 100}%` }}
                />
              ))}
          </div>
        </div>
        <p className="muted small replay-legend">
          <i className="mark mark-screen" /> screen change <i className="mark mark-tap" /> tap <i className="mark mark-rage" /> repeated
          taps <i className="mark mark-custom" /> event
        </p>

        <ol className="replay-log" ref={listRef}>
          {sorted.map((e) => (
            <li
              key={e.id}
              className={`${e.t_ms <= t ? 'done' : ''}${current?.id === e.id ? ' active' : ''}`}
              onClick={() => {
                setT(e.t_ms);
                setPlaying(false);
              }}
            >
              <span className="mono small muted">{fmt(e.t_ms)}</span>
              <span>{e.type === 'screen' ? <strong>{e.screen}</strong> : describe(e)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
