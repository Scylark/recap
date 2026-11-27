<div align="center">
  <img src="./assets/recap-logo-full.png" alt="Recap" width="280" />
  <h1>Recap</h1>
  <p><strong>Hotjar for AI prototypes.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/recap-ux"><img src="https://img.shields.io/npm/v/recap-ux?color=0891b2&label=npm" alt="npm version" /></a>
    <a href="https://bundlephobia.com/package/recap-ux"><img src="https://img.shields.io/bundlephobia/minzip/recap-ux?color=0891b2&label=size" alt="bundle size" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/npm/l/recap-ux?color=0891b2" alt="MIT license" /></a>
    <a href="https://recap-ux.com"><img src="https://img.shields.io/badge/demo-live-0891b2" alt="live demo" /></a>
  </p>

  <br />
  <!-- TODO: record and add demo GIF -->
  <img src="./assets/recap-demo.gif" alt="Recap researcher panel showing a heatmap overlay" width="720" />
  <br /><br />
</div>

## Try the live demo

Try Recap on a live prototype at **[recap-ux.com](https://recap-ux.com)**. The site itself is instrumented with Recap, so click around, then press `Alt+Shift+Y` to see your own session as a heatmap.

## Why Recap

**One line of HTML.** No accounts, no keys, no dashboards to configure. Add the script tag and you're recording.

**Privacy by design.** Recap sets no cookies and sends nothing by default. Data stays on the test device until you export it. Exports can still contain personal data, so treat them like any research data.

**AI-ready.** Exports a structured session summary that Claude or ChatGPT can actually reason about — not just raw coordinates, but a narrative of hesitation, frustration, backtracking, and friction points. Comes with a ready-to-use prompt template.

**One script tag.** Drops into Claude artefacts, Vercel previews, Framer sites, plain HTML — anywhere a `<script>` tag works.

## What Recap captures

- **Click positions** with auto-generated CSS selectors and semantic element labels
- **Scroll depth** per page, with milestone and continuous tracking
- **Navigation flow** — which pages users visited, in what order, for how long
- **Interaction patterns** — hesitation, rapid clicks, backtracking

Everything is processed in the browser. No cookies. No IP addresses. Data stays on the device where the test runs unless you export it or set up a `data-endpoint` (see [Advanced](#advanced)).

## Mobile apps (beta)

Recap now works in production React Native and Expo apps too. Developers add the SDK once; app owners
review real user sessions in a dashboard they host themselves.

- **SDK** in [`sdk-react-native/`](./sdk-react-native): taps, screens, scroll depth, custom events, offline
  queue, consent and sampling. Never records typed text. Can optionally take one picture of each screen
  from your test phone, so heatmaps show what was tapped, and opt-in screen recordings for session replay
  that pause on private screens and while typing.
- **Your own database**: a few SQL files in [`supabase/`](./supabase) set up tables and locked-down access in
  a free Supabase project.
- **Dashboard** in [`dashboard/`](./dashboard): session replay, journeys, tap heatmaps over real screens, screen exit rates,
  one-click AI session summaries and Mixpanel-style analytics (trends, funnels, retention, breakdowns,
  custom events), deployed to your own Vercel or Netlify.

There is no Recap server, account or fee. Point your coding agent at [AGENTS.md](./AGENTS.md) and ask it to
install Recap: the guide walks it through every step, including Apple and Google privacy disclosures
([docs/mobile-privacy.md](./docs/mobile-privacy.md)). To look around first, run `npm run demo` in
`dashboard/`. How it's tested: [docs/testing.md](./docs/testing.md). Try it on
your own phone in about 20 minutes: [docs/try-it-on-your-phone.md](./docs/try-it-on-your-phone.md).

![Recap dashboard](./docs/images/dashboard-session.png)

## Add Recap to a live website

The web script can send sessions to the same Supabase project and dashboard as your mobile apps, so web,
iOS and Android sit side by side in one set of analytics. It takes about 30 minutes, and the defaults are
made for a public site: you don't need any code of your own around it. Leave `supabase` out and Recap
keeps working the original way, with nothing leaving the browser.

**1. Database.** Run every file in [`supabase/migrations/`](./supabase/migrations) in your Supabase project and
add yourself as a dashboard admin ([AGENTS.md](./AGENTS.md), Step 1, has the details). Copy the project URL
and the **anon or publishable** key. Never use the `service_role` or `sb_secret_…` key: Recap refuses it,
logs an error and sends nothing.

**2. Paste the script tag** into every page, and change the values:

```html
<script defer
  src="https://cdn.jsdelivr.net/gh/Scylark/recap@v1.3.0/dist/recap.min.js"
  integrity="REPLACE_WITH_SRI" crossorigin="anonymous"
  data-app-id="my-site"
  data-supabase-url="https://your-project.supabase.co"
  data-supabase-key="sb_publishable_…"
  data-hosts="example.com,*.example.com"
  data-exclude-paths="/account,/admin"
  data-recordings="true"
  data-record-sample="0.2"></script>
```

With that tag Recap:

- runs only on `example.com` and its subdomains, and does nothing on `localhost` or preview deploys;
- does nothing on pages whose path starts `/account` or `/admin`;
- shows visitors no researcher panel, shortcut or three-finger hold;
- labels taps only from `aria-label`, `title`, `alt` and similar, never from on-screen text;
- captures nothing when the browser sends [Global Privacy Control](https://globalprivacycontrol.org/);
- does nothing inside an iframe, so a page embedded on another site isn't counted;
- records one tab in five for replay, with every form field masked. Only those tabs load the recorder.

**3. Mark what's private** with the one privacy marker:

```html
<section data-recap-private>Order history, messages, account details</section>
<p>Signed in as <span data-recap-mask>Jo Bloggs</span></p>
```

| Marker | What it does |
| --- | --- |
| `data-recap-private` (or `class="recap-private"`) | Taps on it and everything inside it aren't counted, and it is left out of recordings. On `<html>` or `<body>` it also stops scroll depth for the page |
| `data-recap-mask` (or `class="recap-mask"`) | Its text is never used to label a tap or a heading, and shows as `*` in recordings. Only your own `data-ut-label` can still label a tap inside it |

Form fields are always masked. The older names `data-ut-no-track`, `ut-block` and `ut-mask` keep working.

**4. Consent.** If your visitors must opt in first, add `data-require-consent="true"` and call `Recap.optIn()`
from your cookie banner. Either way, give them a way out:

```js
Recap.optIn();   // remembered in this browser
Recap.optOut();  // stops at once, deletes anything not yet sent and the copy kept in this browser; other open tabs follow it
```

**5. Check it.** Open your site with `?recap=on` and the browser console open. Recap logs why it is or isn't
running, what it sends and the size of each recording. Then find the session in the dashboard.

### Test switches

Add one to any address. It is remembered for the tab until the tab closes.

| Address | In this tab |
| --- | --- |
| `?recap=on` | Runs even where `hosts` says no (`localhost`, a preview deploy), logs to the console, and sends the session whatever the sample rate |
| `?recap=record` | The same, and records the page for replay whatever `data-record-sample` says |
| `?recap=off` | Nothing runs: keeps your own visits out of the numbers |
| `?recap=auto` | Clears the switch |

### `Recap.status()`

```js
Recap.status(); // { running: false, recording: false, reason: 'host-not-listed' }
```

`running` says whether Recap is capturing on this page, `recording` whether this tab's page is being
recorded for replay, and `reason` why:

| `reason` | Meaning |
| --- | --- |
| `running` | Capturing |
| `not-started` | `Recap.init()` hasn't run yet |
| `host-not-listed` | This hostname isn't in `hosts` |
| `excluded-path` | This page matches `excludePaths` |
| `gpc` | The browser sends Global Privacy Control |
| `opted-out` | The visitor called `Recap.optOut()` |
| `consent-needed` | `requireConsent` is on and `Recap.optIn()` hasn't been called |
| `in-frame` | The page is inside an iframe |
| `secret-key` | The Supabase key is a secret key |
| `switched-off` | `?recap=off` was opened in this tab |

With `debug` on (or `?recap=on`), the reason is also logged once in the console.

### Options

Each script-tag attribute has a matching `Recap.init()` option. "When sending" means sessions go to a
dashboard (`supabase`, `remote` or `Recap.connect()`); without one, the old prototype defaults apply.

| Script tag | `Recap.init()` | Default | What it does |
| --- | --- | --- | --- |
| `data-app-id` | `appId` | the hostname | Name for this site in the dashboard, e.g. `my-shop-web` |
| `data-supabase-url`, `data-supabase-key` | `supabase: { url, anonKey }` | none | Your project URL and anon or publishable key |
| `data-hosts` | `hosts` | everywhere | Hostnames to run on: `example.com` exactly, or `*.example.com` for its subdomains (list both for both). An empty list runs nowhere |
| `data-exclude-paths` | `excludePaths` | none | Path prefixes where nothing runs (`/admin` also covers `/admin/users` and `/admin.html`). `Recap.init()` also takes RegExps |
| `data-recordings="true"` | `recordings` | off | Record pages for replay (see [Recordings](#recordings)) |
| `data-record-sample` | `recordings.sampleRate` | `1` | Share of tabs recorded, `0` to `1` |
| `data-record-canvas` | `recordings.canvas` | off | Record `<canvas>` charts as pictures: `true` for 2 frames a second, or a number |
| `data-recordings-src` | `recordings.src` | next to `recap.min.js` | Where to load `recap-rrweb.min.js` from |
| `data-recordings-integrity` | `recordings.integrity` | none | Subresource integrity hash for that file |
| `data-mask-text` | `recordings.maskText` | the mask marker | `"true"` replaces all text in replays with `*`, or a CSS selector for the parts to mask |
| `data-require-consent="true"` | `requireConsent` | `false` | Record nothing until `Recap.optIn()` |
| `data-panel="true"` | `panel` | off when sending, on otherwise | The researcher panel, its shortcut and touch-hold. `"false"` turns them off everywhere |
| `data-labels` | `labels` | `'attributes'` when sending, `'text'` otherwise | Where tap labels come from (see [Element labelling](#element-labelling)) |
| `data-respect-gpc="false"` | `respectGPC` | `true` when sending | Whether Global Privacy Control stops capture |
| `data-allow-in-frames` | `allowInFrames` | `false` when sending | Run inside iframes |
| `data-debug="true"` | `debug` | `false` | Log to the console. `?recap=on` does it for one tab |
| `data-strip-query-params="false"` | `stripQueryParams` | `true` | Keep query strings in recorded addresses (the hash is always dropped) |
| | `screenName(path)` | the path | The name to count a page under, e.g. `(path) => path.replace(/\.html$/, '')` to count `/plan` and `/plan.html` as one screen. Return nothing to keep the path |

`screenName` (and RegExps in `excludePaths`) need code: add `data-auto-init="false"` to the tag and call
`Recap.init({ screenName })` from your own script once the tag has run (see
[In a Capacitor app](#in-a-capacitor-app) for the pattern). The tag's other settings still apply.

### Recordings

Page recordings use [rrweb](https://github.com/rrweb-io/rrweb) 2.2.2, the version the dashboard plays them
back with. They capture the page's structure and changes rather than pictures, so replays are sharp and
smooth, scrolling and open menus included. Every form field is masked, `data-recap-private` parts are left
out, and the page address keeps only its origin and path.

With the script tag, `data-recordings="true"` is all it takes: a tab that is sampled in loads
`recap-rrweb.min.js` (rrweb's recorder, about 23 kB gzipped) from the same folder as `recap.min.js`, and
other tabs never load it. If you host `recap.min.js` yourself, put `recap-rrweb.min.js` from `dist/` next
to it. If the recorder can't load (a Content-Security-Policy that doesn't allow the folder, for example),
Recap carries on without replays and says why in debug mode.

In debug mode Recap logs the size of each full page snapshot and warns above 2 MB: above 2.5 MB recordings
stop for that session, so mark large parts `data-recap-private`. Recordings need
`supabase/migrations/*_recap_dom.sql`. Try them with the test shop in
[`examples/web-test-shop/`](./examples/web-test-shop).

### With a bundler

`npm install recap-ux` (which installs rrweb 2.2.2 with it). Importing the module starts nothing until you
call `Recap.init()`:

```js
import Recap from 'recap-ux';
import { record } from 'rrweb'; // or recordings: { src: '/recap-rrweb.min.js' }, copied from recap-ux/dist, to load it only in sampled tabs

Recap.init({
  appId: 'my-site',
  supabase: { url: 'https://your-project.supabase.co', anonKey: 'sb_publishable_…' },
  hosts: ['example.com', '*.example.com'],
  excludePaths: ['/account', /^\/orders\/\d+/],
  recordings: { record, sampleRate: 0.2 },
  screenName: (path) => path.replace(/\.html$/, ''),
});
Recap.track('signed_up', { plan: 'pro' }); // custom events for funnels
```

Without `record` or `src`, a module build can't find the recorder, and debug mode says so.

### In a Capacitor app

Inside a Capacitor app the page's hostname is `localhost` by default, so `hosts` leaves the app out, like
your own development server. To count the app as well, add `data-auto-init="false"` to the tag and decide
in your own script:

```html
<script>
  // After the deferred Recap tag has run.
  document.addEventListener('DOMContentLoaded', () => {
    const inApp = window.Capacitor?.isNativePlatform?.() === true;
    Recap.init({ hosts: inApp ? ['localhost'] : ['example.com', '*.example.com'] });
  });
</script>
```

The same pattern passes `screenName` or RegExp `excludePaths`.

### Upgrading from 1.2

- **Breaking:** once sessions go to a dashboard, the researcher panel, its shortcut and its touch-hold are
  off unless you set `panel: true` (`data-panel="true"`). `panel: false` still turns them off everywhere.
- Also once sending, Global Privacy Control stops capture (`respectGPC: false` to change that), nothing
  runs inside an iframe (`allowInFrames: true`), and a secret Supabase key is refused.
- Recordings load rrweb on their own: you can drop the rrweb `<script>` you added before Recap's.
- With the script tag, `window.Recap` is now the API itself, so `Recap.init()`, `Recap.optIn()` and
  `Recap.status()` work as written here. `Recap.Recap` and `Recap.default` still work too.
- Recorded page addresses no longer include the query string (unless `stripQueryParams: false`) or the hash.

## Quick start

Add one line to any prototype:

```html
<script defer src="https://cdn.jsdelivr.net/npm/recap-ux@1/dist/recap.min.js"></script>
```

That's it. Recap starts recording silently. When you're ready to review, press `Alt+Shift+Y` to open the researcher panel.

## AI analysis export

Click **"Export for AI"** in the researcher panel to get a structured JSON summary optimised for LLM analysis. Paste it into Claude with the included prompt template to get a full UX analysis covering friction points, navigation patterns, accessibility observations, and specific recommendations.

The summary is a human-readable narrative of the session, not raw coordinates — an AI can reason about *"Participant hesitated for 12 seconds, then clicked an unlabelled element three times in rapid succession before backtracking"* in a way it never could with a dump of `pageX`/`pageY` values.

## In-person moderated tests

When you're testing in person and need to add another participant, open the same prototype in a new browser tab. Recap creates a new session per tab, so each participant is captured separately.

On a phone or tablet there's no keyboard for `Alt+Shift+Y` — hold **three fingers** on the screen for about **1.5 seconds** instead. It's a deliberately "hidden" gesture (no on-screen button), so it never shows up as something for the participant to notice or tap.

The researcher panel now includes:

- A `Session` help icon directly beside the label
- A hover/focus tooltip with: "To add another participant, open this prototype in a new tab."
- An `Open in new tab` shortcut inside the tooltip

A ready-to-run moderated validation script lives at [`examples/in-person-usability-validation.md`](./examples/in-person-usability-validation.md).

## Configuration

All options are `data-*` attributes on the script tag. The settings for sending to a dashboard, and the
live-site gate, are under [Add Recap to a live website](#options).

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-session-name` | auto | Label for this session, e.g. `"participant-04"` |
| `data-show-panel` | `"false"` | Show researcher panel on load |
| `data-panel` | `"true"`, or `"false"` with Supabase | The researcher panel, its shortcut and the touch-hold. `"false"` turns them off; `"true"` keeps them on when sessions also go to a dashboard |
| `data-shortcut` | `"alt+shift+y"` | Keyboard shortcut for the researcher panel. Format: modifiers and one key joined by `+`, e.g. `"ctrl+shift+y"`. `"false"` for none |
| `data-labels` | `"text"`, or `"attributes"` with Supabase | Where tap labels come from: `"text"`, `"attributes"` or `"none"` (see [Element labelling](#element-labelling)) |
| `data-require-consent` | `"false"` | Record nothing until the page calls `Recap.optIn()` |
| `data-auto-init` | `"true"` | `"false"` waits for the page to call `Recap.init()`, with the tag's settings underneath |
| `data-recap` | none | Marks this tag as Recap's, if you renamed the file. It marks nothing on the page: the privacy markers are `data-recap-private` and `data-recap-mask` |
| `data-supabase-url` | none | Your Supabase project URL. With `data-supabase-key`, sessions also go to the Recap dashboard (see [Add Recap to a live website](#add-recap-to-a-live-website)) |
| `data-supabase-key` | none | Your Supabase **public anon or publishable key**. A `service_role` or `sb_secret_` key is refused |
| `data-app-id` | page hostname | Name for this site in the dashboard, e.g. `my-shop-web` |
| `data-app-version` | none | Your site's version, shown in the dashboard |
| `data-recordings` | `"false"` | With Supabase set: record pages for replay in the dashboard. Tabs sampled in load `recap-rrweb.min.js` from next to `recap.min.js` |
| `data-mask-text` | none | With recordings: `"true"` replaces all text in replays with `*`, or a CSS selector for the parts to mask |
| `data-hosts`, `data-exclude-paths`, `data-respect-gpc`, `data-allow-in-frames`, `data-record-sample`, `data-record-canvas`, `data-recordings-src`, `data-recordings-integrity`, `data-debug` | | See [Options](#options) |
| `data-endpoint` | none | URL to POST captured events to in batches (see [Advanced](#advanced)) |
| `data-strip-query-params` | `"true"` | Remove query strings from recorded URLs. Set to `"false"` to keep them |
| `data-touch-trigger` | `"true"` | Hold 3 fingers on screen to open/close the panel on touch devices |
| `data-touch-trigger-fingers` | `3` | Number of simultaneous touch points required |
| `data-touch-trigger-hold-ms` | `1500` | Hold duration (ms) before the panel toggles |

### Keyboard shortcut not working

The shortcut is matched on the physical key, but another app can still claim the key combination before the browser sees it. If `Alt+Shift+Y` does nothing:

- **Browser extensions:** open `chrome://extensions/shortcuts` in Chrome and look for the same combination. Clear it or change it there.
- **Other apps:** check any global hotkey tools, such as dictation, screen recording or launcher apps.
- **Windows:** `Alt+Shift` is the default keyboard-language switch. If your system uses it, pick a different shortcut.

To use a different key, set `data-shortcut` on the script tag, for example `data-shortcut="ctrl+shift+y"`.

## Element labelling

A tap is counted on the element it was aimed at: the closest button, link, form control, element with a
clickable role, or element with `data-ut-label`. A tap on an icon inside a button is a tap on the button.

Recap labels it from, in order: `data-ut-label`, `aria-label`, `aria-labelledby`, `title`, `alt`, the visible text
(first 50 characters) and `placeholder`. The `labels` setting limits that: `'text'` uses them all,
`'attributes'` everything except the visible text, and `'none'` only `data-ut-label`. It defaults to `'text'`
while data stays in the browser and `'attributes'` once sessions go to a dashboard. For ambiguous elements,
add explicit labels:

```html
<button data-ut-label="Submit assessment">Save</button>
<div data-ut-label="Filter panel">...</div>
```

To keep sensitive things out, use the privacy marker and the mask marker:

```html
<section data-recap-private>No taps counted, and left out of recordings</section>
<span data-recap-mask>Never used in labels, and masked in recordings</span>
```

`data-recap-private` (or `class="recap-private"`) covers everything inside it; on `<html>` or `<body>` it also
stops scroll depth. Inside `data-recap-mask` (or `class="recap-mask"`), only `data-ut-label` can label a tap:
never `aria-label`, `title`, `alt`, `aria-labelledby`, `placeholder` or text. The older names keep working:
`data-ut-no-track` and `ut-block` mean the same as `data-recap-private`, and `ut-mask` the same as
`data-recap-mask`.

## Advanced

### Sending events to your own server

Set `data-endpoint` on the script tag to a URL you control. Recap then posts captured events to that URL in batches, using `navigator.sendBeacon` with a `fetch` fallback. Nothing is sent unless this option is set, and the endpoint receives the same data the panel shows.

### Web sessions in the dashboard

If you use the Recap dashboard for a mobile app (see [Mobile apps](#mobile-apps-beta)), the web library can send to the same Supabase project: see [Add Recap to a live website](#add-recap-to-a-live-website). Pages, clicks, scroll depth and tab switches appear in the dashboard with platform `web`. Typed text is never captured. Without Supabase settings nothing changes: the panel and local storage work as they always have.

## Development

```bash
git clone https://github.com/tonyarbor/recap-ux.git
cd recap-ux
npm install
npm run dev          # Watch mode with example page
npm test             # Run unit tests
npm run build        # Build dist/ bundles
```

Project structure and architecture details are in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Contributing

Contributions welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a pull request. For significant changes, open an issue first to discuss what you'd like to change.

## Licence

MIT © [Tony Craig](https://www.npmjs.com/~tonyarbor)

---

<div align="center">
  <sub>Built with care for designers who want to ship better prototypes.</sub>
</div>
