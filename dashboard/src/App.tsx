import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Session } from '@supabase/supabase-js';
import { listApps, myRole } from './lib/data';
import { isConfigured, isDemo, supabase } from './lib/supabase';
import { readPref, sinceDays, useAsync, useRoute, writePref } from './lib/util';
import { Analytics } from './pages/Analytics';
import { Heatmaps } from './pages/Heatmaps';
import { Login, NotConfigured, NotMember } from './pages/Login';
import { Members } from './pages/Members';
import { Overview } from './pages/Overview';
import { SessionDetail } from './pages/SessionDetail';
import { Sessions } from './pages/Sessions';
import { Storage } from './pages/Storage';
import { Install } from './pages/Install';

const RANGES: { days: number; label: string }[] = [
  { days: 1, label: 'Last 24 hours' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

export function App() {
  const [auth, setAuth] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase || isDemo) return;
    supabase.auth.getSession().then(({ data }) => setAuth(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!isConfigured) return <NotConfigured />;
  if (isDemo) return <SignedIn email="demo@example.com" />;
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
  const [page, arg, arg2] = route;
  const decoded = arg ? decodeURIComponent(arg) : undefined;
  const rangeLabel = RANGES.find((r) => r.days === days)?.label ?? '';
  const nav = (key: string, label: string) => (
    <a href={`#/${key}`} className={page === key || (key === 'sessions' && page === 'session') ? 'active' : ''}>
      {label}
    </a>
  );

  let body: ReactElement;
  if (page === 'members') body = <Members isAdmin={isAdmin} me={email} />;
  else if (page === 'storage') body = <Storage isAdmin={isAdmin} me={email} />;
  else if (page === 'install') body = <Install appId={appId ?? ''} />;
  else if (!appId) {
    body = apps.loading ? (
      <p className="muted">Loading…</p>
    ) : (
      <div className="card empty">
        <h3>Waiting for your first session</h3>
        <p>
          Your database is connected, but no site or app has sent data yet. The Install page has the script tag for a
          website, filled in for this database, and a prompt for your coding agent for a phone app.
        </p>
        <div className="row">
          <a className="button primary" href="#/install">
            Install Recap
          </a>
          <button onClick={() => apps.reload()}>Refresh</button>
        </div>
      </div>
    );
  } else if (page === 'session' && decoded) body = <SessionDetail id={decoded} isAdmin={isAdmin} />;
  else if (page === 'sessions') body = <Sessions appId={appId} since={since} {...(decoded ? { screen: decoded } : {})} />;
  else if (page === 'analytics')
    body = <Analytics appId={appId} since={since} days={days} {...(arg ? { tab: arg } : {})} {...(arg2 ? { arg: decodeURIComponent(arg2) } : {})} />;
  else if (page === 'heatmaps')
    body = <Heatmaps appId={appId} since={since} {...(decoded ? { screen: decoded } : {})} {...(arg2 ? { device: arg2 } : {})} />;
  else body = <Overview appId={appId} since={since} rangeLabel={rangeLabel} />;

  return (
    <div className="shell">
      {isDemo && (
        <div className="demo-banner">
          Demo with sample data. The <strong>test-shop</strong> app holds the real sessions from our end-to-end test run;{' '}
          <strong>demo-shop</strong> is generated sample data. Nothing you do here is saved.
        </div>
      )}
      <header>
        <div className="brand">
          <img src="./favicon.svg" alt="" width={24} height={24} /> Recap
        </div>
        <nav>
          {nav('overview', 'Overview')}
          {nav('sessions', 'Sessions')}
          {nav('analytics', 'Analytics')}
          {nav('heatmaps', 'Heatmaps')}
          {nav('members', 'Team')}
          {nav('storage', 'Storage')}
          {nav('install', 'Install')}
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
          {!isDemo && (
            <button className="link" onClick={signOut} title={email}>
              Sign out
            </button>
          )}
        </div>
      </header>
      <main>{body}</main>
    </div>
  );
}
