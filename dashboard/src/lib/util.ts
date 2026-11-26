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

/** Tiny hash router: #/sessions, #/session/<id>, etc. Works on any static host with no rewrites. */
export function useRoute(): string[] {
  const read = () => (window.location.hash.replace(/^#\/?/, '') || 'overview').split('/');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path: string): void {
  window.location.hash = `#/${path}`;
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
