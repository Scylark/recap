import { useState } from 'react';
import {
  PLACEHOLDER_KEY,
  PLACEHOLDER_URL,
  agentPrompt,
  cleanAppId,
  hostsValue,
  keyProblem,
  scriptTag,
  siteHosts,
  type WebInstall,
} from '../lib/install';
import { db, isDemo } from '../lib/supabase';
import { formatDateTime } from '../lib/util';

type Tab = 'website' | 'app' | 'agent';

const PLACES: { name: string; steps: string }[] = [
  {
    name: 'Google Tag Manager',
    steps:
      'Tags → New → Tag configuration → Custom HTML. Paste the tag, set the trigger to All Pages, save, then Submit to publish. Marketing teams can do this without a developer.',
  },
  {
    name: 'WordPress',
    steps:
      'Use a header-code plugin (WPCode, for example: Code Snippets → Header & Footer → Header) and paste the tag there. Or, in your theme, paste it just before </head> in header.php.',
  },
  { name: 'Webflow', steps: 'Site settings → Custom code → Head code. Paste the tag, save, then publish the site.' },
  {
    name: 'Shopify',
    steps:
      'Online Store → Themes → ⋯ → Edit code → layout/theme.liquid, and paste the tag just before </head>. Not in Customer events: custom pixels run in a sandboxed frame, where Recap does nothing. Checkout pages can\'t load it.',
  },
  { name: 'Framer', steps: 'Site settings → General → Custom code → End of <head> tag. Paste, save, publish.' },
  { name: 'Squarespace', steps: 'Code Injection → Header (in the site settings; needs a plan that allows custom code).' },
  { name: 'Wix', steps: 'Settings → Custom code → Add custom code. Load it in the Head, on all pages (needs a paid plan with a connected domain).' },
  {
    name: 'Your own HTML, or a site generator',
    steps: 'Paste it into the <head> of your shared layout or template, so every page has it.',
  },
];

function useCopy(): [string | null, (label: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  return [
    copied,
    (label, text) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => setCopied(label))
        .catch(() => setCopied(`${label}: couldn't copy. Select the text and copy it instead.`));
      setTimeout(() => setCopied(null), 3000);
    },
  ];
}

export function Install({ appId }: { appId: string }) {
  const envUrl = isDemo ? '' : ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '');
  const envKey = isDemo ? '' : ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '');
  const problem = keyProblem(envKey);
  const url = envUrl || PLACEHOLDER_URL;
  const key = problem ? PLACEHOLDER_KEY : envKey || PLACEHOLDER_KEY;

  const [tab, setTab] = useState<Tab>('website');
  const [o, setO] = useState<WebInstall>({
    appId: appId || 'my-site',
    site: '',
    subdomains: false,
    skip: '/account, /admin',
    record: true,
    canvas: false,
    consent: false,
  });
  const [copied, copy] = useCopy();
  const [check, setCheck] = useState<string | null>(null);
  const set = <K extends keyof WebInstall>(k: K, v: WebInstall[K]) => setO({ ...o, [k]: v });
  const id = cleanAppId(o.appId) || 'my-site';
  const tag = scriptTag(o, url, key);
  const firstHost = siteHosts(o.site)[0];

  async function checkNow() {
    setCheck('Checking…');
    const res = await db()
      .from('recap_sessions')
      .select('started_at, platform')
      .eq('app_id', id)
      .order('started_at', { ascending: false })
      .limit(1);
    if (res.error) return setCheck(res.error.message);
    const row = (res.data ?? [])[0] as { started_at: string } | undefined;
    setCheck(
      row
        ? `It works: the latest visit from ${id} started ${formatDateTime(row.started_at)}. Find it under Sessions.`
        : `No visits from ${id} yet. Open your site with ?recap=on, move between two pages, wait ten seconds and check again.`,
    );
  }

  return (
    <>
      <div className="row space">
        <h2>Install</h2>
        <div className="tabs" role="tablist">
          {(
            [
              ['website', 'Website'],
              ['app', 'Phone app'],
              ['agent', 'With a coding agent'],
            ] as const
          ).map(([k, label]) => (
            <a
              key={k}
              role="tab"
              href="#/install"
              aria-selected={tab === k}
              className={tab === k ? 'active' : ''}
              onClick={(e) => (e.preventDefault(), setTab(k))}
            >
              {label}
            </a>
          ))}
        </div>
      </div>
      <p className="muted small">
        Everything you need to send visits to this dashboard, already filled in with its database address and public
        key. The key is safe to put in a web page: it can only add visits, never read them.
      </p>
      {problem && (
        <p className="error">
          This dashboard is set up with a {problem === 'secret' ? 'secret' : 'service_role'} key. Never put it in a web
          page or app. Replace <code>VITE_SUPABASE_ANON_KEY</code> with the publishable key (Supabase → Project Settings →
          API Keys), redeploy, and rotate the secret key.
        </p>
      )}
      {isDemo && <p className="muted small">Demo: the database address and key below are placeholders.</p>}

      {tab === 'website' && (
        <>
          <form className="card storage-form install-form" onSubmit={(e) => e.preventDefault()}>
            <fieldset>
              <label>
                <span>Name in the dashboard</span>
                <input value={o.appId} onChange={(e) => set('appId', e.target.value)} />
                <small>
                  Sent as <code>{id}</code>. Use one name per site, different from your phone app's.
                </small>
              </label>
              <label>
                <span>Your site's address</span>
                <input placeholder="example.com" value={o.site} onChange={(e) => set('site', e.target.value)} />
                <small>
                  Recap only runs there{hostsValue(o.site, o.subdomains) ? ` (${hostsValue(o.site, o.subdomains).replace(/,/g, ', ')})` : ''}, so test
                  and preview sites stay out. Separate several with commas.
                </small>
              </label>
              <label className="check">
                <span>
                  <input type="checkbox" checked={o.subdomains} onChange={(e) => set('subdomains', e.target.checked)} /> Every
                  subdomain too
                </span>
                <small>For shop.example.com, blog.example.com and so on.</small>
              </label>
              <label>
                <span>Pages to skip</span>
                <input value={o.skip} onChange={(e) => set('skip', e.target.value)} />
                <small>Addresses starting with these aren't counted. Add pages that show personal details.</small>
              </label>
              <label className="check">
                <span>
                  <input type="checkbox" checked={o.record} onChange={(e) => set('record', e.target.checked)} /> Record visits
                  for replay
                </span>
                <small>
                  Every visit, until the limits on the Storage page. Form fields are always hidden. Mark other private parts
                  with <code>data-recap-private</code>.
                </small>
              </label>
              {o.record && (
                <label className="check">
                  <span>
                    <input type="checkbox" checked={o.canvas} onChange={(e) => set('canvas', e.target.checked)} /> Charts drawn
                    on a canvas
                  </span>
                  <small>Records &lt;canvas&gt; charts as pictures so they show in replays.</small>
                </label>
              )}
              <label className="check">
                <span>
                  <input type="checkbox" checked={o.consent} onChange={(e) => set('consent', e.target.checked)} /> Ask
                  visitors first
                </span>
                <small>
                  Nothing is counted until your cookie banner calls <code>Recap.optIn()</code>. Often needed for EU
                  visitors.
                </small>
              </label>
            </fieldset>
          </form>

          <h3>1. Copy this tag</h3>
          <pre className="code" data-testid="install-tag">
            {tag}
          </pre>
          <div className="row">
            <button className="primary" onClick={() => copy('Tag copied', tag)}>
              Copy tag
            </button>
            {copied && <span className="ok small">{copied}</span>}
          </div>

          <h3>2. Paste it into every page's &lt;head&gt;</h3>
          <div className="places">
            {PLACES.map((p) => (
              <details key={p.name}>
                <summary>{p.name}</summary>
                <p className="small">{p.steps}</p>
              </details>
            ))}
            <details>
              <summary>React, Next.js, Vue or another app with a bundler</summary>
              <pre className="code">{`npm install recap-ux

// once, when the app starts (in the browser)
import Recap from 'recap-ux';
import { record } from 'rrweb';

Recap.init({
  appId: '${id}',
  supabase: { url: '${url}', anonKey: '${key}' },
  hosts: [${hostsValue(o.site, o.subdomains)
    .split(',')
    .filter(Boolean)
    .map((h) => `'${h}'`)
    .join(', ')}],
  excludePaths: [${(o.skip.match(/[^\s,]+/g) ?? []).map((p) => `'${p.startsWith('/') ? p : `/${p}`}'`).join(', ')}],${
    o.record ? `\n  recordings: { record${o.canvas ? ', canvas: true' : ''} },` : ''
  }${o.consent ? '\n  requireConsent: true,' : ''}
});`}</pre>
            </details>
          </div>
          <p className="muted small">Menu names change from time to time: look for "custom code", "code injection" or "head".</p>

          <h3>3. Check it works</h3>
          <p className="small">
            Open {firstHost ? <code>https://{firstHost}/?recap=on</code> : 'your site with ?recap=on added to the address'}, move
            between two pages, then press Check. <code>?recap=on</code> also logs what Recap does in the browser console, and{' '}
            <code>Recap.status()</code> says why it isn't running, if it isn't.
          </p>
          <div className="row">
            <button onClick={() => void checkNow()} disabled={isDemo}>
              Check for a visit
            </button>
            {check && <span className="small">{check}</span>}
          </div>

          <h3>4. Before you go live</h3>
          <ul className="small">
            <li>
              Add a switch to your settings that calls <code>Recap.optOut()</code>, and say in your privacy policy that you
              record visits, where they're stored and for how long (90 days to start). Wording to copy:{' '}
              <a href="https://github.com/Scylark/recap/blob/main/docs/privacy-and-store-labels.md" target="_blank" rel="noreferrer">
                privacy and store labels
              </a>
              .
            </li>
            <li>
              Record your own visit with <code>?recap=record</code> and play it back here. Look for other people's names, ids
              in image addresses or links, and anything else private, and mark it with <code>data-recap-private</code>.
            </li>
            <li>
              Keep your own visits out with <code>?recap=off</code> (it lasts for the tab).
            </li>
            <li>
              Lessons from a real install:{' '}
              <a href="https://github.com/Scylark/recap/blob/main/docs/learnings.md" target="_blank" rel="noreferrer">
                what we learned
              </a>
              .
            </li>
          </ul>
        </>
      )}

      {tab === 'app' && (
        <div className="card">
          <p>
            Recap works in React Native and Expo apps (iOS and Android). The quickest way is to ask your coding agent: copy
            the prompt from the <a href="#/install" onClick={(e) => (e.preventDefault(), setTab('agent'))}>With a coding agent</a>{' '}
            tab. By hand, follow{' '}
            <a href="https://github.com/Scylark/recap/blob/main/AGENTS.md" target="_blank" rel="noreferrer">
              AGENTS.md
            </a>{' '}
            from Step 2 with these values:
          </p>
          <pre className="code">{`EXPO_PUBLIC_RECAP_SUPABASE_URL=${url}\nEXPO_PUBLIC_RECAP_SUPABASE_ANON_KEY=${key}`}</pre>
          <p className="muted small">
            A Capacitor or Ionic app uses the website tag instead, with <code>localhost</code> added to its hosts inside the
            app. See "In a Capacitor app" in the README.
          </p>
        </div>
      )}

      {tab === 'agent' && (
        <>
          <p className="small">
            Open your project in Claude Code, Cursor, Codex or Copilot and paste one of these. The agent installs Recap and
            asks you the privacy questions as it goes.
          </p>
          {(['web', 'app'] as const).map((kind) => {
            const text = agentPrompt(kind, kind === 'web' ? o.appId : `${id}-app`, url, key, o.site);
            return (
              <div key={kind} className="card agent-prompt">
                <h3>{kind === 'web' ? 'Website' : 'React Native or Expo app'}</h3>
                <pre className="code">{text}</pre>
                <button className="primary" onClick={() => copy(kind === 'web' ? 'Website prompt copied' : 'App prompt copied', text)}>
                  Copy prompt
                </button>
              </div>
            );
          })}
          {copied && <p className="ok small">{copied}</p>}
        </>
      )}
    </>
  );
}
