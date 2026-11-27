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
- Screen views from React Navigation, Expo Router (`useRecapScreen(usePathname())`) or manual calls
- Scroll depth, foreground and background, custom events
- Offline queue, batching, sampling, consent and opt-out
- Never records typed text
- Optional screen recordings for session replay, paused while typing and on `<RecapPrivate>` views
- Optional screen pictures for heatmaps (one per screen per app version, via `react-native-view-shot`; we suggest `screenshots: __DEV__`)
- Pure TypeScript, no native modules of its own, iOS and Android

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
