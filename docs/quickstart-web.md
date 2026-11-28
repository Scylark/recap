# Recap on a live website in 30 minutes

You need: a website you can add a `<script>` tag to, a free [Supabase](https://supabase.com) account, and a
free Vercel or Netlify account for the dashboard. No build step, no npm.

| Step | Time |
| --- | --- |
| 1. Create the database | 5 min |
| 2. Run the setup file | 3 min |
| 3. Put the dashboard online | 7 min |
| 4. Add the script tag | 3 min |
| 5. Check it works | 5 min |
| 6. Privacy policy and opt-out | 7 min |

## 1. Create the database (5 min)

1. In Supabase, **New project**. A separate project just for Recap is cleanest. Pick a region near your
   users (for UK users, London). Keep the database password in your password manager; you won't need it
   for Recap.
2. When it's ready, open **Project Settings → API Keys** and copy:
   - the **Project URL**, `https://<ref>.supabase.co`
   - the **Publishable key** (`sb_publishable_…`), or the legacy **anon public** key.

   Never use the secret or `service_role` key anywhere in Recap. Recap refuses one.

## 2. Run the setup file (3 min)

1. Open **SQL Editor → New query**, paste the whole of
   [`supabase/setup.sql`](../supabase/setup.sql) and press **Run**. If Supabase warns that the query is
   "destructive", press **Run this query**: it only recreates Recap's own access rules. The last row says
   `Recap is set up`.
2. In a new query, make yourself the first admin (the email you'll sign in to the dashboard with):

   ```sql
   insert into public.recap_members (email, role) values ('you@example.com', 'admin');
   ```

Defaults: data older than 90 days is deleted, new recordings stop at 300 MB in all and 10 MB per visit
(visits are still counted), and new sessions pause at 400 MB (the free plan allows 500 MB). Change them
later on the dashboard's **Storage** page.

## 3. Put the dashboard online (7 min)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FScylark%2Frecap&root-directory=dashboard&env=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY&envDescription=Your%20Supabase%20Project%20URL%20and%20publishable%20key%20(Project%20Settings%20-%3E%20API%20Keys)&project-name=recap-dashboard)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/Scylark/recap)

1. Click a button and give it the two values from step 1: `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (the publishable key). The dashboard is a static site; it only reads data a
   signed-in team member is allowed to see.
2. In Supabase, **Authentication → URL Configuration**: set the **Site URL** to the dashboard's address
   and add `https://<your-dashboard>/**` under **Redirect URLs**, so sign-in emails come back to it.
3. Open the dashboard and sign in with the email from step 2 (an emailed link, or a password).

## 4. Add the script tag (3 min)

Put this in the `<head>` of every page you want counted:

```html
<script defer data-recap
  src="https://cdn.jsdelivr.net/gh/Scylark/recap@v1.3.0/dist/recap.min.js"
  integrity="sha384-8wgD4Wmlu6eME7JD9xA+I/gWbqutajBp2faL0205zSqQYR1kmkBAIkpubfFtUdh5" crossorigin="anonymous"
  data-supabase-url="https://YOUR-REF.supabase.co"
  data-supabase-key="sb_publishable_YOUR_KEY"
  data-app-id="my-site"
  data-hosts="example.com,www.example.com"
  data-exclude-paths="/admin"></script>
```

- `data-app-id` names the site in the dashboard.
- `data-hosts` limits counting to your real site, so localhost and preview deploys stay out.
- `data-exclude-paths` skips pages entirely (prefixes).

What you get by default on a live site: Recap's own panel stays hidden, typing is never recorded, tap
labels come from attributes you set (`data-ut-label`) or ARIA labels, not from the words on screen, and
browsers that send Global Privacy Control are not counted.

**Hide parts of a page:** add `class="recap-private"` (or `data-recap-private`) to anything that must never
be counted or recorded.

**Screen replays (optional):** add `data-recordings="true"` to record every visit, until recordings reach
the limits on the Storage page (step 2). On a busy site, add `data-record-sample="0.2"` to record one
visit in five. Recap loads its recorder (`recap-rrweb.min.js`, next to `recap.min.js`) only for recorded
visits. Add `data-record-canvas="true"` if your pages draw charts on a canvas. In the dashboard's session
list, recorded visits are marked and listed first.

### Heatmaps on a website

The dashboard's **Heatmaps** page draws a web page at its full length and puts each tap where it landed
on the page, for phones, tablets and desktops separately (their layouts differ, so one map for all of
them would mean nothing). What makes the maps good:

- **Turn on recordings.** The page behind the taps is the newest recorded visit of that page at that
  window size. Without one, the taps are drawn on a blank page. If the newest visit is an odd one (a menu
  open, signed out), **Try another recording** draws the next.
- **Name your key buttons** with `data-ut-label="Start trial"` (or give them an `id`). Most tapped then
  lists them by that name, and the same name in every visit groups their taps even when the layout moves.
- **Let the window scroll.** Scroll depth and page positions come from the window. A page that scrolls
  inside its own container (a full-height `<div>` with `overflow: auto`) reports every tap and scroll as
  if it were at the top.
- **Bars that stay on screen** (a fixed header, a bottom tab bar) are found on the recorded page and
  their taps drawn on them, at the top or bottom of the map.

How to read it:

- **The fold** is the bottom of a typical window at that size when the page opens. **Taps above the fold**
  counts the taps made without scrolling.
- **How far down**: the share of visits that scrolled 25%, 50%, 75% of the way and to the end. Each line
  on the map is where the bottom of the window was at that depth.
- **Rage taps**: three or more quick taps on one spot in one visit, usually something that didn't respond.
- **Dead taps**: taps on something that isn't a link, button or form field and has no `data-ut-label`.
  People expected it to do something: a price, a card, a picture.
- **Which visits**: compare the visits that sent one of your events (`Recap.track('signed_up')`) with
  the visits that didn't.
- Under 30 visits the page says so: a pattern that small can be chance.

Limits: a map reads the newest 5,000 taps on a screen in the period. Charts drawn on a `<canvas>` show
blank on the map (they replay fine in a session). Pages that change a lot from visit to visit (a feed, a
basket) are drawn as the recorded visit saw them, so taps from other visits can land on different items.

## 5. Check it works (5 min)

1. Open any page with `?recap=on` added to the address. That counts this tab even off your listed hosts
   and logs what Recap does in the browser console. `?recap=record` also records this tab, and
   `?recap=off` stops it; `?recap=auto` goes back to normal.
2. In the console, `Recap.status()` says whether it is running and, if not, why
   (`host-not-listed`, `excluded-path`, `gpc`, `opted-out`, …).
3. Within a few seconds the visit appears in the dashboard under **Sessions**.

## 6. Privacy policy and opt-out (7 min)

1. Add a switch to your settings that calls `Recap.optOut()` (and `Recap.optIn()` to turn it back on).
   Opting out stops Recap at once in every open tab and deletes what hasn't been sent.
2. Copy the wording in [privacy-and-store-labels.md](privacy-and-store-labels.md) into your privacy policy
   and adjust it. In the UK and EU you may need consent first: use `data-require-consent="true"` and call
   `Recap.optIn()` from your consent banner.
3. If you ship an app with the same pages (Capacitor and similar), that file also has the App Store and
   Google Play label answers.

Done. Day to day, everything is in the dashboard: sessions and replays, heatmaps, funnels, retention, and
the Storage page for limits.
