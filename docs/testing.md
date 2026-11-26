# How Recap mobile is tested

| What | How | Where |
| --- | --- | --- |
| SDK logic: sessions, consent, sampling, offline queue, batching, tap labels, start-up buffering, Supabase key headers | 14 unit tests | `sdk-react-native/tests/` |
| Database: ingest, counters, app isolation, anon can't read, only team members can read, viewers can't delete, admin tools, retention | SQL checks on a real Postgres | `supabase/tests/security.sql` |
| AI summary built from mobile events | 3 unit tests | `dashboard/tests/` |
| **End to end**: SDK inside a real Expo app → HTTP → database | Playwright taps through the app as two users on a phone-sized screen, one starting offline | `examples/expo-test-shop/` |
| Dashboard screens | Rendered against the recorded test sessions and sample data (`npm run demo` in `dashboard/`) | `dashboard/src/demo/` |

CI (`.github/workflows/mobile.yml`) runs the first three on every change.

## Result of the end-to-end run (26 Nov 2026)

Both test users produced complete sessions: first screen, all 5 taps with their button names, two
scroll milestones, the custom `added_to_basket` event and both screen changes (11 events each). The
offline user's events were held, retried, and delivered once the connection came back. The recorded
sessions are the `test-shop` app in the dashboard demo.

This run found and fixed two bugs: taps were dropped on platforms that only report the finger position in
`changedTouches` at touch end, and the first screen was missed because the SDK only started recording
after saved state had loaded.

The example app was then moved to Expo SDK 58 (React Native 0.88, what the current Expo Go app runs)
and the same run passed again. Its iOS and Android bundles also compile with Hermes.

## Not yet covered

- The SDK has run in Expo's web build, not yet on a physical iPhone or Android device or a simulator.
  It is plain JavaScript with no native code, so behaviour should match, but touch details can differ by
  platform and a device run is the next step.
- The database was a local Postgres 16 with Supabase's roles and `auth.jwt()` recreated, plus a small
  stand-in for Supabase's API. It has not yet been run against a hosted Supabase project, and the
  dashboard's real sign-in (Supabase Auth email links) has not been exercised.
- No load testing yet. Batches are capped at 500 events and 500 KB, and the dashboard reads at most
  5,000 taps per heatmap, which suits small and medium apps.
