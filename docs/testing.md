# How Recap mobile is tested

| What | How | Where |
| --- | --- | --- |
| SDK logic: sessions, consent, sampling, offline queue, batching, tap labels, start-up buffering, Supabase key headers, install id, screen pictures (once per screen and version, exclusions, skipped if the person moved on), recordings (unchanged frames skipped, pauses for keyboard, private views and excluded screens, frame cap, quick extra frames after taps and scrolls) | 20 unit tests | `sdk-react-native/tests/` |
| Database: ingest, counters, app isolation, anon can't read, only team members can read, viewers can't delete, admin tools, retention | SQL checks on a real Postgres | `supabase/tests/security.sql` |
| Analytics and screen pictures: event names, funnel, retention, properties, pictures replace older ones, non-images refused, anon and strangers see nothing | SQL checks on a real Postgres | `supabase/tests/analytics-and-screens.sql` |
| Recordings: frames stored only for a known session of the same app, non-images refused, anon and strangers can't read, viewers can't delete, frames deleted with their session | SQL checks on a real Postgres | `supabase/tests/recordings.sql` |
| Storage limits: defaults, only admins change them, sessions and replays sampled, daily cap, size cap, frame cap, refused sessions dropped quietly, old data deleted automatically and by "Delete old data now" | SQL checks on a real Postgres | `supabase/tests/storage-limits.sql` |
| Recording limits: each visit's recording stops at its limit (web and app), new recordings stop at the recordings limit while visits already recording carry on and new visits are still counted, recorded sessions are marked for the session list, the app can't call the helpers | SQL checks on a real Postgres | `supabase/tests/recording-limits.sql` |
| Storage page form: values checked and converted, recording limits left out on older databases, sizes formatted | 4 unit tests | `dashboard/tests/storage-form.test.ts` |
| Analytics numbers: the database functions and the demo's copies give identical results for trends, breakdowns, funnels and retention on 151 sample sessions | 13 checks against a real Postgres | `dashboard/tests/analytics-parity.test.ts` |
| AI summary built from mobile events | 3 unit tests | `dashboard/tests/` |
| **End to end**: SDK inside a real Expo app → HTTP → database | Playwright taps through the app as two users on a phone-sized screen, one starting offline; screen pictures and recording frames (including a privacy pause on checkout) are sent and stored too | `examples/expo-test-shop/` |
| **On a phone**: the test shop on a real Android phone in Expo Go, sending to a hosted Supabase project | By hand, 26 Nov 2026: 27 events with correct button names, visible in the dashboard | `docs/try-it-on-your-phone.md` |
| Dashboard screens | Rendered against the recorded test sessions and sample data (`npm run demo` in `dashboard/`) | `dashboard/src/demo/` |

CI (`.github/workflows/mobile.yml`) runs the first six on every change.

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

- The SDK has run on an Android phone, not yet on an iPhone.
- Recordings have not yet run on a real phone, so frame size and battery use there are estimates.
- Screen pictures on a real phone use react-native-view-shot, which isn't available in the browser build,
  so the automated end-to-end test sends a placeholder picture to check the upload and storage path.
  The first real pictures will come from the next phone run.
- No load testing yet. Batches are capped at 500 events and 500 KB, and the dashboard reads at most
  5,000 taps per heatmap, which suits small and medium apps.
