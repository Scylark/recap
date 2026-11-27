import { useEffect, useMemo, useRef, useState } from 'react';
import { Replayer } from 'rrweb';
import 'rrweb/dist/style.css';
import type { DomEvent } from '../lib/data';
import type { EventRow } from '../lib/types';

/**
 * Plays back a website session recorded with rrweb: the page itself, rebuilt from its structure and
 * changes, so scrolling, menus and transitions look exactly as they did. Form fields were masked
 * when recorded. The session's events (taps, page views, custom events) are listed alongside and
 * can be clicked to jump there.
 */

const SPEEDS = [1, 2, 4] as const;

interface Props {
  events: EventRow[];
  recording: DomEvent[];
  /** Where the recording starts in the session's timeline, in ms. */
  startMs: number;
  describe: (e: EventRow) => string;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function WebReplay({ events, recording, startMs, describe }: Props) {
  const sorted = useMemo(() => [...events].sort((a, b) => a.t_ms - b.t_ms), [events]);
  const stage = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<Replayer | null>(null);
  const [size, setSize] = useState({ width: 1280, height: 800 });
  const [box, setBox] = useState(720);
  const [t, setT] = useState(startMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [skipIdle, setSkipIdle] = useState(true);

  const total = useMemo(() => {
    if (recording.length < 2) return 1000;
    return recording[recording.length - 1]!.timestamp - recording[0]!.timestamp;
  }, [recording]);
  const end = Math.max(startMs + total, (sorted[sorted.length - 1]?.t_ms ?? 0) + 500);

  // Build the player once per recording.
  useEffect(() => {
    if (!holder.current || recording.length < 2) return;
    holder.current.innerHTML = '';
    const r = new Replayer(recording as unknown as ConstructorParameters<typeof Replayer>[0], {
      root: holder.current,
      showWarning: false,
      mouseTail: { strokeStyle: 'rgba(14, 116, 144, 0.5)', lineWidth: 2, duration: 600 },
      skipInactive: true,
      triggerFocus: false,
    });
    const first = recording.find((e) => e.type === 4) as { data?: { width?: number; height?: number } } | undefined;
    if (first?.data?.width && first.data.height) setSize({ width: first.data.width, height: first.data.height });
    r.on('resize', (d) => {
      const dim = d as { width: number; height: number };
      if (dim.width && dim.height) setSize({ width: dim.width, height: dim.height });
    });
    r.on('finish', () => setPlaying(false));
    r.pause(0);
    player.current = r;
    setT(startMs);
    return () => {
      r.destroy();
      player.current = null;
    };
  }, [recording, startMs]);

  useEffect(() => player.current?.setConfig({ speed, skipInactive: skipIdle }), [speed, skipIdle]);

  // Fit the recorded page into the available width.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox(el.clientWidth));
    ro.observe(el);
    setBox(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, box / size.width);

  // While playing, follow the player's clock.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => {
      const r = player.current;
      if (r) setT(startMs + r.getCurrentTime());
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, startMs]);

  // Rebuilding or scrolling the recorded page can make the browser scroll the dashboard itself.
  // Only the person viewing should move the dashboard, so undo any scroll they didn't make.
  const viewerY = useRef(0);
  const viewerActiveAt = useRef(0);
  useEffect(() => {
    viewerY.current = window.scrollY;
    const mark = (e: Event) => {
      // A click on the page's scrollbar lands on <html>; clicks on buttons don't scroll anything.
      if (e.type === 'pointerdown' && e.target !== document.documentElement) return;
      viewerActiveAt.current = performance.now();
    };
    const onScroll = () => {
      if (performance.now() - viewerActiveAt.current < 800) viewerY.current = window.scrollY;
      else if (window.scrollY !== viewerY.current) window.scrollTo(0, viewerY.current);
    };
    const events = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  const keepScroll = (fn: () => void) => fn();

  const seek = (to: number, play = playing) => {
    const r = player.current;
    const clamped = Math.max(startMs, Math.min(end, to));
    setT(clamped);
    if (!r) return;
    keepScroll(() => (play ? r.play(clamped - startMs) : r.pause(clamped - startMs)));
  };

  const toggle = () => {
    const r = player.current;
    if (!r) return;
    if (playing) {
      r.pause();
      setPlaying(false);
    } else {
      const from = t >= end - 100 ? startMs : t;
      keepScroll(() => r.play(from - startMs));
      setPlaying(true);
    }
  };

  const current = [...sorted].reverse().find((e) => e.t_ms <= t);
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

  if (recording.length < 2) {
    return <p className="muted">This web session has no page recording yet.</p>;
  }

  return (
    <div className="web-replay">
      <div className="web-replay-stage" ref={stage} style={{ height: Math.round(size.height * scale) }}>
        <div
          className="web-replay-page"
          ref={holder}
          style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
        />
        <div className="replay-mode rec">● Page recording</div>
      </div>

      <div className="replay-controls">
        <button className="primary replay-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚ Pause' : t >= end - 100 ? '↺ Replay' : '▶ Play'}
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
          min={startMs}
          max={end}
          step={50}
          value={t}
          aria-label="Position in session"
          onChange={(e) => {
            seek(Number(e.target.value), false);
            setPlaying(false);
          }}
        />
        <div className="scrubber-marks" aria-hidden>
          {sorted
            .filter((e) => e.type === 'screen' || e.type === 'tap' || e.type === 'custom' || e.type === 'scroll')
            .map((e) => (
              <i key={e.id} className={`mark mark-${e.type}`} style={{ left: `${((e.t_ms - startMs) / Math.max(1, end - startMs)) * 100}%` }} />
            ))}
        </div>
      </div>

      <ol className="replay-log" ref={listRef}>
        {sorted.map((e) => (
          <li
            key={e.id}
            className={`${e.t_ms <= t ? 'done' : ''}${e.id === current?.id ? ' active' : ''}`}
            onClick={() => {
              seek(e.t_ms, false);
              setPlaying(false);
            }}
          >
            <span className="mono">{fmt(e.t_ms)}</span>
            <span>{e.type === 'screen' ? <strong>{e.screen}</strong> : describe(e)}</span>
          </li>
        ))}
      </ol>
      <p className="muted small">Form fields are masked in recordings; anything marked private on the site is left out.</p>
    </div>
  );
}
