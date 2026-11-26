# Installing Recap in a mobile app: guide for coding agents

You are a coding agent (Claude Code, Cursor, Codex, Copilot or similar) and a developer has asked you to
add Recap to their app. This file tells you everything you need. Follow it in order, ask the developer the
questions marked **Ask**, and do not skip the privacy steps.

## What Recap is

Recap is free, open-source (MIT) session analytics for mobile apps. It records which screens people visit,
where they tap, how far they scroll and when they leave, then shows it in a dashboard with journeys, tap
heatmaps and a one-click AI summary of any session.

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
| Database | `supabase/migrations/` | One SQL file: tables, security rules, ingest function |
| Dashboard | `dashboard/` | Static React app the owner deploys and signs in to |
| Web prototypes | `src/` | The original `recap-ux` script for web prototypes (separate, unchanged) |

Supported today: **React Native 0.72+ and Expo SDK 50+, iOS and Android.** Native Swift/Kotlin and Flutter
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
  copy `supabase/migrations/20261126000000_recap.sql` from this repo into their `supabase/migrations/` folder
  and run `supabase db push`.
- **Without the CLI:** ask the developer to open the Supabase dashboard, SQL Editor, paste the whole file
  and press Run. It is safe to run more than once.

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

Optional, recommended: automatic deletion after 90 days. In the SQL editor, enable the `pg_cron`
extension and run `select cron.schedule('recap-retention', '0 3 * * *', $$select public.recap_purge(90)$$);`

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
4. Remove `debug: true`.

If nothing arrives: check the URL and anon key, that the SQL ran without errors, and that the device has
network access. Upload errors are logged when `debug` is on.

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
| `appVersion` | | Shown in the dashboard |
| `debug` | `false` | Console logging |

API: `recap.screen(name)`, `recap.track(name, props)`, `recap.setUserId(id | null)`, `recap.optIn()`,
`recap.optOut()`, `recap.flush()`, `recapPress(label, handler)`, `useRecapScreen(name)`, `useRecapScroll()`.

### Using your own backend instead of Supabase

Set `endpoint: { url: 'https://api.example.com/recap', headers: { Authorization: 'Bearer ...' } }`. Each
request body is one JSON batch: `{ appId, sdkVersion, session: { id, startedAt, userId, device }, events: [{ type, t, at, screen, data }] }`.
Store it however you like. The bundled dashboard reads the Supabase tables, so with a custom backend you
would either load the batches into Postgres with the same schema (the `recap_ingest` function does exactly
that) or build your own views.

## Working on this repo

- SDK: `cd sdk-react-native && npm install && npm test && npm run typecheck`
- Dashboard: `cd dashboard && npm install && npm test && npm run build` (`npm run demo` runs it with sample data, no database)
- End-to-end test and a working example app: `examples/expo-test-shop/` (see its README)
- What is and isn't tested yet: `docs/testing.md`
- Database checks against a scratch Postgres:
  `psql -f supabase/tests/supabase-shim.sql -f supabase/migrations/20261126000000_recap.sql -f supabase/tests/security.sql`
- The web library in `src/` has its own tests: `npm install && npm test` at the root.
