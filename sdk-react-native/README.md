# @recap-ux/react-native

Free, open-source session analytics for React Native and Expo apps. See where people tap, which screens
they visit, where they give up, and get an AI-ready summary of any session. Data goes to **your own**
Supabase project and is viewed in a dashboard **you** deploy. No Recap account, no SaaS, no fees.

```tsx
<RecapProvider
  navigationRef={navigationRef}
  config={{ appId: 'my-app', supabase: { url, anonKey }, storage: AsyncStorage }}
>
  <NavigationContainer ref={navigationRef}>…</NavigationContainer>
</RecapProvider>
```

- Taps anywhere in the app, without touching your gesture handling
- Screen views from React Navigation, Expo Router (see below) or manual calls
- Scroll depth, foreground and background, custom events
- Offline queue, batching, sampling, consent and opt-out
- No keystrokes or field contents in events
- Optional screen recordings for session replay, paused while the keyboard is open and while a `<RecapPrivate>` is mounted
- Optional screen pictures for heatmaps (one per screen per app version, via `react-native-view-shot`; we suggest `screenshots: __DEV__`), with the same pauses
- Pure TypeScript, no native modules of its own, iOS and Android

Recordings and screen pictures are images of the screen. The keyboard pause covers typing, but a field
that shows its value once the keyboard closes is visible in them unless it is inside `<RecapPrivate>`, so
wrap forms, account pages and anything else showing personal details.

## Expo Router

Name screens by route pattern rather than by address. `usePathname()` gives the real address, such as
`/orders/8812` or `/user/jane`, which puts order numbers and names into your analytics; `useSegments()`
keeps dynamic segments as written, so every order page is one screen, `/orders/[id]`.

```tsx
// app/_layout.tsx
import { Stack, useSegments } from 'expo-router';
import { RecapProvider, useRecapScreen } from '@recap-ux/react-native';

function ScreenTracker() {
  const segments = useSegments();
  useRecapScreen('/' + segments.join('/')); // "/orders/[id]", never "/orders/8812"
  return null;
}

export default function RootLayout() {
  return (
    <RecapProvider config={config}>
      <ScreenTracker />
      <Stack />
    </RecapProvider>
  );
}
```

Group folders appear in the name too (`/(tabs)/orders/[id]`). Filter them out of `segments` if you'd rather
not see them.

## Session ids

Session and install ids come from `crypto.randomUUID` or `crypto.getRandomValues`. Hermes has neither by
default, so install `react-native-get-random-values` and import it once at the top of your entry file;
without it Recap falls back to `Math.random` and says so when `debug` is on.

## Keys

Use the Supabase **anon** or **publishable** key. Recap refuses a `service_role` or `sb_secret_…` key: it
logs an error and records and sends nothing, because anyone with the app could read that key.

**Full setup, written for your coding agent:** [AGENTS.md](../AGENTS.md). Give your agent the repo link and ask
it to "install Recap following AGENTS.md".

Privacy and store disclosures: [docs/mobile-privacy.md](../docs/mobile-privacy.md).

## Development

```bash
npm install
npm test
npm run typecheck
```

MIT licensed. Based on [Recap](https://github.com/colourandcode1/recap) by Tony Craig.
