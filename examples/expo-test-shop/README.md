# Expo test shop

A five-screen Expo shop (Home, Product, Basket, Checkout, Confirmation) with the Recap SDK wired in the way
AGENTS.md describes: React Navigation screen tracking, labelled buttons with `recapPress`, scroll depth with
`useRecapScroll`, custom events, screen pictures and AsyncStorage for the offline queue.

It has the things real apps have, so the dashboard has something to show: category chips, a sort dropdown,
a size dropdown that blocks "Add to basket" until you choose, colour chips, quantity steppers, a reviews
accordion, a promo code that never works (for frustrated repeat taps), a checkout form with validation,
a delivery dropdown, a gift-wrap switch, a newsletter checkbox and a star rating. Typed text is never
recorded, only that a field was tapped and which fields failed validation.

It doubles as the end-to-end test: a phone-sized browser taps through the app as two users and checks
that every event reaches the database through the same `recap_ingest` function and permissions a real
Supabase project uses. The second user starts offline to prove queued events are delivered later.

## Run the end-to-end test

You need Node 18+, a scratch Postgres 15+ and Playwright's Chromium (`npx playwright install chromium`).

```bash
# 1. Database (from the repo root)
createdb recap_e2e
psql -d recap_e2e -f supabase/tests/supabase-shim.sql -f supabase/migrations/20261126000000_recap.sql

# 2. App
cd examples/expo-test-shop
npm install
npm run export:web

# 3. Stand-in for Supabase's API (checks the anon key, then calls recap_ingest as the anon role)
PGDATABASE=recap_e2e node e2e/server.cjs &

# 4. Tap through the app as two users
npm run e2e
psql -d recap_e2e -c "select type, screen, data from recap_events order by session_id, t_ms"
```

## Run it against your own Supabase project

Set `EXPO_PUBLIC_RECAP_SUPABASE_URL` and `EXPO_PUBLIC_RECAP_SUPABASE_ANON_KEY`, then `npx expo start` and
open it on a phone with Expo Go, or press `w` for the browser.
