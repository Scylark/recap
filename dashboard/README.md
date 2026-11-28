# Recap dashboard

The dashboard for Recap's mobile SDK. A static web app you host yourself (Vercel, Netlify, any static
host) that reads sessions from your own Supabase project.

- **Overview:** sessions, average length, screens per session, and per-screen views, taps and exit rates
- **Sessions:** every session with its journey, filterable by platform and user id
- **Session detail:** a **replay** that plays the session back, using real screen recordings when the app
  sends them (moments paused for privacy show as hidden) or otherwise screen pictures, taps
  rippling in, repeated taps in red, scrolls, events and time away, with speed and skip-pauses controls),
  a screen-by-screen timeline, tap heatmap per visit, and **Copy AI summary** to paste
  into Claude or ChatGPT for a UX analysis
- **Heatmaps:** all taps on a screen across sessions.
  - **Websites:** the whole page at its full length, for Phone, Tablet or Desktop windows, drawn from the
    newest recorded visit of that page (try another, or watch that visit). Taps go where they landed on
    the page; taps on a bar that stays on screen go on the bar. With the fold, how far down visits
    scrolled, rage taps (quick repeated taps on one spot), dead taps (on things that aren't links or
    buttons), Most tapped with the share of visits, a CSV of it, and visits that did or didn't send one
    of your events (for example, visits that signed up). See [Heatmaps on a website](../docs/heatmaps.md).
  - **Apps:** the screen at a phone's shape, drawn over a picture of that screen when the app has
    `screenshots` turned on, plus the most-tapped named buttons
- **Analytics:** Mixpanel-style product analytics on the same data
  - **Trends:** any event over time, as totals or unique people, split by platform, app version, screen,
    OS, device, language or any custom property
  - **Funnels:** step-by-step conversion with drop-off, time between steps and a conversion window
  - **Retention:** weekly or daily cohorts, showing how many people come back
  - **Breakdowns:** one event split by any property
  - **Events:** every screen view, named tap and custom event, with its properties
- **Team:** invite viewers and admins by email, and delete a user's data on request

Sign-in uses Supabase Auth (email link or password). Only emails in the `recap_members` table can see data.

## Run locally

```bash
cp .env.example .env.local   # add your Supabase URL and anon key
npm install
npm run dev
```

## Deploy

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, build with `npm run build`, and host `dist/`.
Step-by-step instructions for Vercel and Netlify are in [AGENTS.md](../AGENTS.md#step-6-deploy-the-dashboard).
