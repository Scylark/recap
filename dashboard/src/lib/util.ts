import { useEffect, useState } from 'react';

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function sessionSeconds(s: { started_at: string; last_seen_at: string }): number {
  return (Date.parse(s.last_seen_at) - Date.parse(s.started_at)) / 1000;
}

export function sinceDays(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Tiny router: #/sessions, #/session/<id>, etc. Works on any static host with no rewrites.
 * Navigation goes through go(), which also works inside sandboxed frames that ignore hash links.
 */
let current = readHash();
const listeners = new Set<() => void>();

function readHash(): string {
  return window.location.hash.replace(/^#\/?/, '') || 'overview';
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const on = () => setRoute(current);
    const onHash = () => {
      current = readHash();
      listeners.forEach((l) => l());
    };
    listeners.add(on);
    window.addEventListener('hashchange', onHash);
    return () => {
      listeners.delete(on);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
  return route.split('/');
}

export function go(path: string): void {
  current = path || 'overview';
  try {
    window.history.replaceState(null, '', `#/${current}`);
  } catch {
    /* sandboxed frame */
  }
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

/** Send clicks on in-app links (href="#/...") through go(). Call once at startup. */
export function interceptLinks(): void {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    go(a.getAttribute('href')!.slice(2));
  });
}

/** Load async data with loading and error states. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (err: unknown) => live && setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/**
 * useAsync whose result belongs to the inputs it was loaded for. While new inputs load, `data` is null
 * rather than the old inputs' result, so one device's taps are never drawn over another's page.
 * Inputs must be plain values (they are compared as JSON).
 */
export function useKeyedAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const key = JSON.stringify(deps);
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fn().then(
      (data) => live && setState({ key, data, error: null }),
      (err: unknown) => live && setState({ key, data: null, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const fresh = state.key === key;
  return { data: fresh ? state.data : null, error: fresh ? state.error : null, loading: !fresh, reload: () => setTick((t) => t + 1) };
}

export function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`recap:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`recap:${key}`, value);
  } catch {
    /* private mode */
  }
}
