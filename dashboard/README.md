# Recap dashboard

The dashboard for Recap's mobile SDK. A static web app you host yourself (Vercel, Netlify, any static
host) that reads sessions from your own Supabase project.

- **Overview:** sessions, average length, screens per session, and per-screen views, taps and exit rates
- **Sessions:** every session with its journey, filterable by platform and user id
- **Session detail:** screen-by-screen timeline, tap heatmap per visit, and **Copy AI summary** to paste
  into Claude or ChatGPT for a UX analysis
- **Heatmaps:** all taps on a screen across sessions, drawn over a picture of that screen when the app has
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
