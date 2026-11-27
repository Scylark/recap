# Installing Recap in a mobile app: guide for coding agents

You are a coding agent (Claude Code, Cursor, Codex, Copilot or similar) and a developer has asked you to
add Recap to their app. This file tells you everything you need. Follow it in order, ask the developer the
questions marked **Ask**, and do not skip the privacy steps.

## What Recap is

Recap is free, open-source (MIT) session analytics for mobile apps. It records which screens people visit,
where they tap, how far they scroll and when they leave, then shows it in a dashboard with session replays, journeys, tap
heatmaps drawn over real screen pictures, a one-click AI summary of any session, and product analytics
(trends, funnels, retention, breakdowns and custom events, in the style of Mixpanel).

There is **no Recap company server, account, API key or payment**. Everything runs in infrastructure the
app owner controls:

```
 ┌──────────────┐  batches over HTTPS   ┌─────────────────────────┐   read (signed in)   ┌──────────────────┐
 │  Their app   │ ────────────────────▶ │ Their Supabase project  │ ◀──────────────────── │ Recap dashboard  │
 │ + Recap SDK  │  insert-only anon key │ (Postgres, free tier ok)│   team members only   │ (static site on  │
 └──────────────┘                       └─────────────────────────┘                       │ their Vercel etc)│
                                                                                          └──────────────────┘
```

| Part | Where it lives in this repo | What it is |
| --- | --- | --- |
| SDK | `sdk-react-native/` | React Native / Expo package `@recap-ux/react-native` |
| Database | `supabase/migrations/` | SQL files: tables, security rules, ingest, analytics functions, screen pictures |
| Dashboard | `dashboard/` | Static React app the owner deploys and signs in to |
| Web | `src/` | The `recap-ux` web script. On its own it keeps data in the browser; with `supabase` set it sends to the same database and dashboard (see "Websites and web apps" below) |

Supported today: **React Native 0.72+ and Expo SDK 50+ (tested on SDK 54 and 58), iOS and Android.** Native Swift/Kotlin and Flutter
are not available yet. If the app is not React Native, tell the developer that and stop.

## Step 0. Check the project

1. Confirm this is a React Native or Expo app (`package.json` has `react-native` or `expo`).
2. Note the navigation library: React Navigation (`@react-navigation/native`), Expo Router (`expo-router`) or other.
3. Note whether `@react-native-async-storage/async-storage` is installed (it is used for the offline queue).

## Step 1. Database (one-time, about 3 minutes)

**Ask:** "Do you already have a Supabase project you want Recap data in, or shall we create a new one?
A separate free project is the cleanest option."

The developer must do the sign-up part themselves at https://supabase.com (you cannot create accounts).
Then either:

- **With the Supabase CLI** (preferred when the project is linked):
  copy every file in this repo's `supabase/migrations/` into their `supabase/migrations/` folder and run
  `supabase db push`.
- **Without the CLI:** ask the developer to open the Supabase dashboard, SQL Editor, and paste and run each
  file in `supabase/migrations/` in name order (sessions and events first, then analytics, then screen
  pictures). Each is safe to run more than once, so when Recap is updated, just run them all again.

Then add the first dashboard admin. **Ask** for the email they will sign in with, and have them run:

```sql
insert into public.recap_members (email, role) values ('their-email@example.com', 'admin');
```

Collect two values from Supabase, Project Settings, API:
- **Project URL**, e.g. `https://abcd1234.supabase.co`
- **anon public key**

The anon key is designed to be public and is safe to ship in the app: with Recap's rules it can only call
the `recap_ingest` function and cannot read any data. **Never** put the `service_role` key in the app or
the dashboard.

Storage limits come with the migrations: data older than 90 days is deleted automatically, and new
sessions pause if Recap's data reaches 400 MB (Supabase's free plan allows 500 MB). An admin can change
both, and the share of sessions and replays kept, on the dashboard's **Storage** page. These limits are
enforced in the database, so they apply to every app without an app update.

## Step 2. Install the SDK

Until the package is published to npm, install it from GitHub:

```bash
# Copy the SDK source into the app (works with Expo and bare React Native, no native build step)
npx degit Scylark/recap/sdk-react-native vendor/recap-react-native
npm install ./vendor/recap-react-native
npm install @react-native-async-storage/async-storage   # if not already installed
```

(If it has been published, `npm install @recap-ux/react-native` instead.) The SDK is pure TypeScript with
no native modules, so no `pod install` or prebuild is needed beyond what the app already does.

Put the keys in the app's normal config. For Expo, use `EXPO_PUBLIC_` env vars:

```
EXPO_PUBLIC_RECAP_SUPABASE_URL=https://abcd1234.supabase.co
EXPO_PUBLIC_RECAP_SUPABASE_ANON_KEY=eyJ...
```

## Step 3. Wrap the app

Add `RecapProvider` once, as high as possible in the tree. Choose the block that matches the navigation.

**React Navigation**

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { RecapProvider } from '@recap-ux/react-native';

const navigationRef = createNavigationContainerRef();

export default function App() {
  return (
    <RecapProvider
      navigationRef={navigationRef}
      config={{
        appId: 'my-app',                       // short, stable name; use one per app
        supabase: {
          url: process.env.EXPO_PUBLIC_RECAP_SUPABASE_URL!,
          anonKey: process.env.EXPO_PUBLIC_RECAP_SUPABASE_ANON_KEY!,
        },
        storage: AsyncStorage,
        appVersion: '1.0.0',                   // or read from expo-constants / react-native-device-info
      }}
    >
      <NavigationContainer ref={navigationRef}>{/* ...existing app... */}</NavigationContainer>
    </RecapProvider>
  );
}
```

**Expo Router** (in `app/_layout.tsx`)

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, usePathname } from 'expo-router';
import { RecapProvider, useRecapScreen } from '@recap-ux/react-native';

function ScreenTracker() {
  useRecapScreen(usePathname());
  return null;
}

export default function RootLayout() {
  return (
    <RecapProvider config={{ appId: 'my-app', supabase: { url: process.env.EXPO_PUBLIC_RECAP_SUPABASE_URL!, anonKey: process.env.EXPO_PUBLIC_RECAP_SUPABASE_ANON_KEY! }, storage: AsyncStorage }}>
      <ScreenTracker />
      <Stack />
    </RecapProvider>
  );
}
```

**Other navigation:** call `recap.screen('ScreenName')` whenever the visible screen changes.

Optional device details (nicer dashboard): if `expo-device` is installed, pass
`device={{ model: Device.modelName ?? null }}` to `RecapProvider`.

**Screen pictures behind heatmaps (recommended).** Heatmaps are far easier to read with the real screen
underneath. Install `react-native-view-shot` (`npx expo install react-native-view-shot`; it needs a
development build or a store build, and Expo Go already includes it), then:

```tsx
import { captureRef } from 'react-native-view-shot';

<RecapProvider captureRef={captureRef} config={{ ...config, screenshots: __DEV__ }}>
```

The SDK takes one small JPEG of each screen, once per app version, about a second after the screen opens,
and only if the person is still on it. **Recommend `screenshots: __DEV__`** so pictures only come from the
developer's own test phone, never from real users' screens, which may show their personal details. If the
owner wants pictures from production builds, ask first, and list screens that show personal data in
`screenshots: { exclude: ['Account', 'Checkout'] }`.

**Screen recordings for session replay (optional, ask the owner first).** The dashboard's replay works
without them, using the screen pictures above. For true recordings, add `recordings` to the same config
(it uses the same `captureRef`):

```tsx
import { RecapPrivate } from '@recap-ux/react-native';

config={{ ...config, recordings: { sampleRate: 0.1, exclude: ['Account'] } }}

// Wrap anything showing personal details. Recording pauses while it is on screen.
<RecapPrivate><CheckoutForm /></RecapPrivate>
```

The SDK takes a small JPEG (about 10 to 25 KB) roughly once a second while the app is open (plus two quick extra ones just after a tap, a scroll or a new screen, so the replay shows what moved), skips frames
where nothing changed, and stops after 600 pictures per session (`maxFrames`), which is about ten minutes of use. It pauses on its own while the keyboard is
open, on `exclude` screens and while any `<RecapPrivate>` is mounted; those moments show as "Hidden for
privacy" in the replay. Before turning it on in production:
- **Ask** the owner, and find every screen that shows names, addresses, payment details, messages or
  health data. Wrap those in `<RecapPrivate>` or list them in `exclude`.
- Use `sampleRate` (e.g. `0.1`) on busy apps: Supabase's free database is 500 MB, and a ten-minute
  recording is a few MB. The dashboard's Storage page can also keep replays for only a share of
  sessions, and deletes old data automatically.
- Update the privacy policy and store disclosures (see docs/mobile-privacy.md).
- Check how the app shows menus, pickers and bottom sheets. A React Native `<Modal>` (and libraries
  built on it) opens a separate native window that recordings can't see, so the replay shows the page
  underneath and taps inside it aren't counted. The quickest fix is a one-line import swap:
  `import { RecapModal as Modal } from '@recap-ux/react-native'` (same props; while open, replay frames
  capture the modal itself). Or draw the sheet inside the app's own view, as the test shop's `SheetHost` does.

## Step 4. Make the data readable

These are small edits but they make the dashboard far more useful. Do them for the app's main flows.

1. **Name important buttons** so heatmaps and AI summaries say "Tapped Add to basket" instead of coordinates:
   ```tsx
   import { recapPress } from '@recap-ux/react-native';
   <Pressable onPress={recapPress('Add to basket', addToBasket)} />
   ```
   Use short, human names. Never put user data (names, emails, order numbers) in a label.
2. **Scroll depth** on long screens:
   ```tsx
   const onScroll = useRecapScroll();
   <ScrollView onScroll={onScroll} scrollEventThrottle={250}>...</ScrollView>
   ```
   (If the list already has an `onScroll`, pass it in: `useRecapScroll(existingHandler)`.)
3. **Key moments** as custom events: `recap.track('checkout_completed', { items: 3 })`. Keep properties free
   of personal data.
4. **User id (optional):** `recap.setUserId(internalUserId)` after sign-in and `recap.setUserId(null)` on
   sign-out. Use the app's internal id, never an email or phone number. Skip this if the owner prefers fully
   anonymous sessions.

## Step 5. Privacy and consent (required)

What Recap collects: screen names, tap positions, optional button labels, scroll depth, app foreground and
background, custom events, device platform, OS version, model, screen size, locale, app version, and a
random session id. It does **not** collect typed text, screenshots, IP-derived location, advertising ids or
contacts, and it never shares data with anyone other than the owner's own database.

1. **Consent. Ask:** "Do your users need to opt in before analytics run (for example, you have EU/UK users
   and no other lawful basis)?" If yes, set `requireConsent: true` and call `recap.optIn()` when the user
   agrees in the app's existing consent screen. In all cases, give users a way out by calling
   `recap.optOut()` from a settings toggle; it also deletes anything not yet uploaded.
2. **Apple privacy manifest.** Recap itself uses no "required reason" APIs and needs no tracking domains.
   AsyncStorage ships its own manifest. Make sure the app's `PrivacyInfo.xcprivacy` (Expo:
   `ios.privacyManifests` in `app.json`) lists collected data type **Product Interaction**, purpose
   **Analytics**, not linked to identity (linked if `setUserId` is used), not used for tracking.
   See `docs/mobile-privacy.md` for a copy-paste block.
3. **App Store "App Privacy" answers** and **Google Play "Data safety" form:** use the answers in
   `docs/mobile-privacy.md`. Tell the developer these must be updated before the next store submission.
4. **No ATT prompt is needed.** Recap is first-party analytics: no IDFA, no cross-app tracking, no data
   brokers. Do not add `NSUserTrackingUsageDescription` for Recap.
5. Mention the app's privacy policy should say it records in-app usage analytics, stored in the owner's
   own database, and how long it is kept.

## Step 6. Deploy the dashboard

The dashboard is a static site. **Ask** where they want to host it (Vercel and Netlify both have free plans).

- **Vercel:** import the repo (or their fork of it) with root directory `dashboard`, framework Vite, and set
  the env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as the app).
  One-click link:
  `https://vercel.com/new/clone?repository-url=https://github.com/Scylark/recap&root-directory=dashboard&env=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY`
- **Netlify:** new site from the repo; `dashboard/netlify.toml` already sets the build. Add the same env vars.
- **Anywhere else:** `cd dashboard && npm install && npm run build`, then serve `dashboard/dist/` from any
  static host or nginx. It uses hash routes, so no rewrite rules are needed.
- **Locally:** `cd dashboard && cp .env.example .env.local` (fill it in) and `npm install && npm run dev`.

Then in Supabase, Authentication, URL Configuration: set **Site URL** to the dashboard URL and add it to
**Redirect URLs**, otherwise email sign-in links will point to localhost. Email sign-in links are enabled by
default; for a team, also consider turning off open sign-ups (only listed members can see data either way).

## Step 7. Verify

1. Temporarily set `debug: true` in the config, run the app on a simulator or phone and move between a few
   screens. Logs should show `[Recap] uploaded N events` within about ten seconds.
2. Sign in to the dashboard with the admin email. The session should appear under Sessions.
3. Open it and press **Copy AI summary** to check the summary reads sensibly.
4. Open **Analytics**: Trends should show today's sessions, and Events should list the screens and any
   `recap.track` names.
5. If screenshots are on, open **Heatmaps**: each screen visited for more than a second should show its
   picture behind the taps (logs show `[Recap] screenshot of Home saved`).
6. Remove `debug: true`.

If nothing arrives: check the URL and anon key, that the SQL ran without errors, and that the device has
network access. Upload errors are logged when `debug` is on.

## Websites and web apps

If the developer also has a website or web app, it can report to the same database and dashboard. The web
script's defaults are made for a live site, so **don't write a loader or wrapper around it**: limiting it to
production hostnames, skipping private pages, Global Privacy Control, iframes, consent, test switches and
loading rrweb for replays are all built in. The README section "Add Recap to a live website" has the full
option table.

1. **Database.** Same project as the app (Step 1). For replays, also make sure
   `supabase/migrations/20261127025000_recap_dom.sql` and `20261127040000_recap_dom_limits.sql` have run (the
   second makes web recordings follow the Storage page limits). Use the anon or publishable key: Recap refuses a
   `service_role` or `sb_secret_` key with a console error and sends nothing.
2. **Ask** for the site's production hostnames (e.g. `example.com` and its subdomains) and which pages or parts
   of pages show personal details (account pages, order history, messages, anything with an id in the address).
3. **Add it.** For a site without a build step, paste one script tag on every page, with a different
   `data-app-id` from the mobile app:
   ```html
   <script defer
     src="https://cdn.jsdelivr.net/gh/Scylark/recap@v1.3.0/dist/recap.min.js"
     integrity="REPLACE_WITH_SRI" crossorigin="anonymous"
     data-app-id="my-site-web"
     data-supabase-url="https://abcd1234.supabase.co"
     data-supabase-key="sb_publishable_…"
     data-hosts="example.com,*.example.com"
     data-exclude-paths="/account,/admin"
     data-recordings="true"
     data-record-sample="0.2"></script>
   ```
   With a bundler: `npm install recap-ux` (it brings `rrweb@2.2.2`) and call, once at start-up,
   `Recap.init({ appId, supabase: { url, anonKey }, hosts, excludePaths, recordings: { record, sampleRate } })`
   with `import { record } from 'rrweb'`. Importing the module starts nothing until `init()`.
   Once sessions go to the dashboard, the researcher panel, its shortcut and three-finger hold are off for
   visitors, and tap labels come only from `aria-label`, `title`, `alt` and similar, never on-screen text.
   Don't add `panel: false`; add `panel: true` only if the owner wants the panel on the live site.
4. **Mark private parts.** Whole pages go in `data-exclude-paths` / `excludePaths` (string prefixes; RegExps in
   `init()`). Inside other pages, add `data-recap-private` to anything showing personal details: taps there aren't
   counted and it is left out of recordings. Add `data-recap-mask` to text that must never be used, such as a
   signed-in name: it is never a tap label and shows as `*` in replays. Form fields are always masked. If pages
   show personal text outside those parts, use `data-mask-text="true"` (or `recordings: { maskText: true }`). Use
   `labels: 'none'` if even `aria-label`s can hold personal details. (The older `class="recap-private"`,
   `data-ut-no-track`, `ut-block` and `ut-mask` still work; use the `data-recap-*` names in new code.)
5. **Consent. Ask** the same question as on mobile (Step 5). If they need opt-in, add `data-require-consent="true"`
   (or `requireConsent: true`) and call `Recap.optIn()` from their consent banner. Either way, wire
   `Recap.optOut()` to a settings switch. Global Privacy Control is respected by default.
6. If one screen has several addresses (`/plan` and `/plan.html`, or ids in the path), pass
   `screenName: (path) => …` in the first `init()` call so they count as one screen. With the script tag, add
   `data-auto-init="false"` and call `Recap.init({ screenName })` on `DOMContentLoaded`; the tag's settings still apply.
7. Add `Recap.track('event_name', { … })` for the steps that matter (sign-up, add to basket, purchase), as on mobile.
8. **Verify.** Open a page with `?recap=on` (it also works on `localhost` and preview deploys) and the console
   open: Recap logs `[Recap] running…` or why it isn't, what it uploads and each recording snapshot's size.
   `Recap.status()` returns `{ running, recording, reason }`. Use `?recap=record` to record that tab for replay,
   `?recap=off` to keep the developer's own visits out, and `?recap=auto` to clear the switch. Then check the
   session in the dashboard.
9. In a Capacitor app the page's hostname is `localhost`, so `hosts` leaves the app out. If the owner wants app
   sessions too, add `data-auto-init="false"` and call
   `Recap.init({ hosts: window.Capacitor?.isNativePlatform?.() ? ['localhost'] : [...] })` on `DOMContentLoaded`.
   Recap does nothing inside an iframe once sending; `allowInFrames: true` changes that.

If the site sets a Content-Security-Policy, `script-src` must allow the folder `recap.min.js` comes from
(`recap-rrweb.min.js` loads from the same place) and `connect-src` the Supabase project URL.

## Configuration reference

| Option | Default | Notes |
| --- | --- | --- |
| `appId` | required | Short stable name. One database can hold several apps. |
| `supabase` | | `{ url, anonKey }` of the owner's project |
| `endpoint` | | `{ url, headers? }` to POST JSON batches to the owner's own API instead |
| `transport` | | Custom `{ send(batch) }` for anything else |
| `storage` | memory only | AsyncStorage, MMKV or similar; keeps the queue across restarts |
| `sampleRate` | `1` | Share of sessions recorded, e.g. `0.2` for 20% on very busy apps |
| `requireConsent` | `false` | Record nothing until `recap.optIn()` |
| `flushIntervalMs` | `10000` | Upload interval |
| `maxBatchSize` | `50` | Events per request |
| `maxQueueSize` | `1000` | Offline cap; oldest dropped first |
| `sessionTimeoutMs` | `1800000` | Background time after which a new session starts |
| `appVersion` | | Shown in the dashboard; also lets you filter analytics by release |
| `recordings` | `false` | `true`, or `{ sampleRate?, intervalMs? (1000), maxFrames? (600), exclude?, width? (280), quality? (0.4) }`. Needs `captureRef` |
| `screenshots` | `false` | `true`, or `{ exclude?: string[], delayMs?: number }`. Needs the `captureRef` prop. Suggest `__DEV__` |
| `debug` | `false` | Console logging |

Props on `RecapProvider`: `config`, `navigationRef?`, `device?`, `captureRef?` (from react-native-view-shot).

API: `recap.screen(name)`, `recap.track(name, props)`, `recap.setUserId(id | null)`, `recap.optIn()`,
`recap.optOut()`, `recap.flush()`, `recap.getAnonymousId()`, `<RecapPrivate>`, `useRecapPrivate()`, `<RecapModal>`, `recapPress(label, handler)`, `useRecapScreen(name)`, `useRecapScroll()`.

### Using your own backend instead of Supabase

Set `endpoint: { url: 'https://api.example.com/recap', headers: { Authorization: 'Bearer ...' } }`. Each
request body is one JSON batch: `{ appId, sdkVersion, session: { id, startedAt, userId, anonymousId, device }, events: [{ type, t, at, screen, data }] }`.
Recording frames go to `framesUrl` as `{ appId, sessionId, frames: [{ t, image | null }] }`.
Screen pictures need their own URL: `endpoint: { url, screenshotUrl }` receives
`{ appId, screen, platform, appVersion, width, height, image }` where `image` is a base64 JPEG data URL.
Store it however you like. The bundled dashboard reads the Supabase tables, so with a custom backend you
would either load the batches into Postgres with the same schema (the `recap_ingest` function does exactly
that) or build your own views.

## Working on this repo

- SDK: `cd sdk-react-native && npm install && npm test && npm run typecheck`
- Dashboard: `cd dashboard && npm install && npm test && npm run build` (`npm run demo` runs it with sample data, no database)
- End-to-end test and a working example app: `examples/expo-test-shop/` (see its README)
- What is and isn't tested yet: `docs/testing.md`
- Hands-on trial on a phone (for people, not agents): `docs/try-it-on-your-phone.md`
- Database checks against a scratch Postgres: run `supabase/tests/supabase-shim.sql`, then every file in
  `supabase/migrations/` in order, then `supabase/tests/security.sql`, `supabase/tests/analytics-and-screens.sql` and `supabase/tests/recordings.sql`.
- Analytics parity (database functions vs the demo's copies):
  `cd dashboard && RECAP_TEST_PG=postgres://... TZ=UTC npx vitest run tests/analytics-parity.test.ts` on a scratch database.
- The web library in `src/` has its own tests: `npm install && npm test` at the root.
