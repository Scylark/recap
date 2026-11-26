import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Session } from '@supabase/supabase-js';
import { listApps, myRole } from './lib/data';
import { isConfigured, supabase } from './lib/supabase';
import { readPref, sinceDays, useAsync, useRoute, writePref } from './lib/util';
import { Heatmaps } from './pages/Heatmaps';
import { Login, NotConfigured, NotMember } from './pages/Login';
import { Members } from './pages/Members';
import { Overview } from './pages/Overview';
import { SessionDetail } from './pages/SessionDetail';
import { Sessions } from './pages/Sessions';

const RANGES: { days: number; label: string }[] = [
  { days: 1, label: 'Last 24 hours' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

export function App() {
  const [auth, setAuth] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setAuth(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!isConfigured) return <NotConfigured />;
  if (auth === undefined) return <div className="centre muted">Loading…</div>;
  if (!auth) return <Login />;
  return <SignedIn email={auth.user.email ?? ''} />;
}

function SignedIn({ email }: { email: string }) {
  const role = useAsync(myRole, [email]);
  const apps = useAsync(listApps, [email, role.data]);
  const route = useRoute();
  const [appId, setAppId] = useState(() => readPref('app', ''));
  const [days, setDays] = useState(() => Number(readPref('days', '7')) || 7);
  const since = useMemo(() => sinceDays(days), [days]);
  const signOut = () => void supabase?.auth.signOut();

  useEffect(() => {
    const list = apps.data ?? [];
    if (list.length && !list.includes(appId)) setAppId(list[0]!);
  }, [apps.data, appId]);

  if (role.loading) return <div className="centre muted">Loading…</div>;
  if (role.error) return <div className="centre error">{role.error}</div>;
  if (!role.data) return <NotMember email={email} onSignOut={signOut} />;

  const isAdmin = role.data === 'admin';
  const [page, arg] = route;
  const decoded = arg ? decodeURIComponent(arg) : undefined;
  const rangeLabel = RANGES.find((r) => r.days === days)?.label ?? '';
  const nav = (key: string, label: string) => (
    <a href={`#/${key}`} className={page === key || (key === 'sessions' && page === 'session') ? 'active' : ''}>
      {label}
    </a>
  );

  let body: ReactElement;
  if (page === 'members') body = <Members isAdmin={isAdmin} me={email} />;
  else if (!appId) {
    body = apps.loading ? (
      <p className="muted">Loading…</p>
    ) : (
      <div className="card empty">
        <h3>Waiting for your first session</h3>
        <p>
          Your database is connected, but no app has sent data yet. Add the Recap SDK to your app (see AGENTS.md in
          the repo), open the app on a phone or simulator, then refresh this page.
        </p>
        <button onClick={() => apps.reload()}>Refresh</button>
      </div>
    );
  } else if (page === 'session' && decoded) body = <SessionDetail id={decoded} isAdmin={isAdmin} />;
  else if (page === 'sessions') body = <Sessions appId={appId} since={since} {...(decoded ? { screen: decoded } : {})} />;
  else if (page === 'heatmaps') body = <Heatmaps appId={appId} since={since} {...(decoded ? { screen: decoded } : {})} />;
  else body = <Overview appId={appId} since={since} rangeLabel={rangeLabel} />;

  return (
    <div className="shell">
      <header>
        <div className="brand">
          <img src="./favicon.svg" alt="" width={24} height={24} /> Recap
        </div>
        <nav>
          {nav('overview', 'Overview')}
          {nav('sessions', 'Sessions')}
          {nav('heatmaps', 'Heatmaps')}
          {nav('members', 'Team')}
        </nav>
        <div className="controls">
          {(apps.data?.length ?? 0) > 1 && (
            <select value={appId} onChange={(e) => (setAppId(e.target.value), writePref('app', e.target.value))}>
              {apps.data!.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          )}
          <select value={days} onChange={(e) => (setDays(Number(e.target.value)), writePref('days', e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
          <button className="link" onClick={signOut} title={email}>
            Sign out
          </button>
        </div>
      </header>
      <main>{body}</main>
    </div>
  );
}
