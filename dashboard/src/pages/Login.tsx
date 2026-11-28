import { useState, type FormEvent } from 'react';
import { db } from '../lib/supabase';
import { useAsync } from '../lib/util';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'link' | 'password'>('link');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (mode === 'link') {
        const { error } = await db().auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        });
        if (error) throw error;
        setStatus('Check your inbox for a sign-in link.');
      } else {
        const { error } = await db().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centre">
      <form className="card login" onSubmit={submit}>
        <img src="./favicon.svg" alt="" width={40} height={40} />
        <h1>Recap</h1>
        <p className="muted">Sign in to review your app's sessions.</p>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        {mode === 'password' && (
          <label>
            Password
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        <button className="primary" disabled={busy}>
          {mode === 'link' ? 'Email me a sign-in link' : 'Sign in'}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === 'link' ? 'password' : 'link')}>
          {mode === 'link' ? 'Use a password instead' : 'Use an email link instead'}
        </button>
        {status && <p className="ok">{status}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

export function NotMember({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  // Only offer the "make yourself admin" SQL while the team has no admin at all (first set-up).
  const hasAdmin = useAsync(async () => {
    const res = await db().rpc('recap_has_admin');
    if (res.error) throw new Error(res.error.message);
    return res.data as boolean;
  }, []);
  const sqlEmail = email.replace(/'/g, "''");
  return (
    <div className="centre">
      <div className="card login">
        <h1>No access yet</h1>
        <p>
          You're signed in as <strong>{email}</strong>, but this email isn't on the Recap team list, or it hasn't been
          confirmed yet. If you signed up with a password, open the confirmation email first.
        </p>
        {hasAdmin.data === false ? (
          <>
            <p className="muted">
              This team has no admin yet. If you're setting Recap up, run this in the Supabase SQL editor to make yourself
              the first admin:
            </p>
            <pre className="code">{`insert into public.recap_members (email, role)\nvalues ('${sqlEmail}', 'admin');`}</pre>
          </>
        ) : (
          <p className="muted">Ask an admin to add you on the Team page.</p>
        )}
        <button onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

export function NotConfigured() {
  return (
    <div className="centre">
      <div className="card login">
        <h1>Connect your database</h1>
        <p>
          This dashboard needs your Supabase project's URL and public anon key. Set these environment variables
          where you deploy it (or in <code>dashboard/.env.local</code> when running locally), then rebuild:
        </p>
        <pre className="code">{`VITE_SUPABASE_URL=https://<project-ref>.supabase.co\nVITE_SUPABASE_ANON_KEY=<public anon key>`}</pre>
        <p className="muted">
          Both are under Project Settings, API in Supabase. The full guide is in AGENTS.md at the root of the
          Recap repository.
        </p>
      </div>
    </div>
  );
}
