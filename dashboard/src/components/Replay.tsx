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

  const frameTimes = useMemo(() => frames.filter((f) => f.image).map((f) => f.t_ms), [frames]);
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
        // Recording frames are only stored when the screen changed, so they count as activity too:
        // a scroll has frames but few events, and must not be skipped as a pause.
        const nextEvent = sorted.find((e) => e.t_ms > tRef.current)?.t_ms ?? Infinity;
        const nextFrame = frameTimes.find((ft) => ft > tRef.current) ?? Infinity;
        const upcoming = Math.min(nextEvent, nextFrame);
        if (upcoming !== Infinity && upcoming - next > IDLE_GAP_MS) next = upcoming - 600;
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
  }, [playing, speed, skipIdle, sorted, frameTimes, end]);

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
  // One steady phone size for the whole replay, so the view never jumps between pictures.
  const height = useMemo(() => {
    const sized = Object.values(pictures).find((p) => p.width && p.height);
    return Math.round(width * (sized ? sized.height! / sized.width! : aspect));
  }, [pictures, aspect]);

  // Fade from the previous picture to the next rather than cutting.
  const src = picture?.image;
  const [layers, setLayers] = useState<{ prev?: string; cur?: string }>({ cur: src });
  useEffect(() => {
    setLayers((l) => (l.cur === src ? l : { prev: l.cur, cur: src }));
  }, [src]);

  const toggle = () => {
    if (!playing && t >= end) setT(0);
    setPlaying((p) => !p);
  };

  // Keep the active row in the event list in view while playing. Only the list scrolls:
  // scrollIntoView would also move the whole page, making the view jump at every tap.
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!playing) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('.active');
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [current?.id, playing]);

  return (
    <div className="replay">
      <div className="replay-stage">
        <div className="phone replay-phone" style={{ width, height }}>
          {picture ? (
            <>
              {/* Screen pictures fade from one screen to the next; recording frames cut, so they stay crisp. */}
              {!recorded && layers.prev && layers.prev !== src && (
                <img src={layers.prev} alt="" aria-hidden className="phone-bg replay-bg" />
              )}
              <img key={recorded ? 'frame' : src} src={src} alt={`${screen} screen`} className={`phone-bg replay-bg${recorded ? '' : ' replay-fade'}`} />
            </>
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
              .filter((e) => e.type === 'screen' || e.type === 'tap' || e.type === 'custom' || e.type === 'scroll')
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
          taps <i className="mark mark-custom" /> event <i className="mark mark-scroll" /> scroll
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
