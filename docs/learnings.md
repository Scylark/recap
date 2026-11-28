# What we learned putting Recap on a real product

Recap's first production install was [WattPlan](https://wattplan.cc), a cycling coach with a no-build web app
on Firebase Hosting and a Capacitor phone app, in November 2026. Every gap it hit was fixed in Recap itself
(1.2.0, 1.3.0 and the recording limits), and WattPlan's own loader shrank from 497 lines to about 220. These
are the lessons that still apply to anyone installing Recap.

## Before you start

- **Use a separate Supabase project for Recap.** It keeps visit data apart from your users' accounts, and
  its free 500 MB is all Recap's. Pick the region your users are in (London for UK users) and say so in
  your privacy policy.
- **Decide what's private with the owner before you write code.** WattPlan's owner looked at real screens
  and said a user's own data (training, chat, account details) can be recorded. The rule that came out of
  it is simple: hide *other people's* information (a coach looking at their clients, an admin's alerts
  naming users), and anything typed, which Recap always masks.
- **Draft the privacy policy change first** and ship it in the same release as Recap, so the policy is never
  behind the site. [privacy-and-store-labels.md](privacy-and-store-labels.md) has wording to start from.

## Where personal data hides

A recording is a copy of the page. Things you never see on screen still end up in it, so record your own
visit with `?recap=record` and look for these:

| Where | What we found | Fix |
| --- | --- | --- |
| Image addresses | The profile photo URL was `profile-images/<user id>/avatar` | `data-recap-private` on every avatar `<img>` |
| `data-*` attributes | Buttons carried another user's id in `data-uid` | Use a row number in the page and keep ids in the script |
| Query strings | A coach's page was `coach-rider.html?rider=<user id>` | Recap 1.3 strips query and hash from recorded addresses; path segments are still kept, so mark pages with ids in the path private or skip them with `excludePaths` |
| `aria-label` and `title` | Calendar days were labelled with ride and event names | `labels: 'none'`, plus a fixed `data-ut-label="Calendar day"` on controls you want named |

Taps resolve to the nearest button or link, so a fixed `data-ut-label` on the button names taps on its icon too.

## Getting it to run where you want, and only there

- **List your real hosts** (`data-hosts` / `hosts`). Local servers, preview deploys and your hosting
  provider's other domains (`*.web.app`, `*.vercel.app`) are then left out automatically.
- **Test anywhere with a switch.** `?recap=on` runs Recap in this tab and logs what it does,
  `?recap=record` also records it, `?recap=off` keeps your own visits out, `?recap=auto` goes back to
  normal. `Recap.status()` says why it isn't running (`host-not-listed`, `excluded-path`, `gpc`,
  `opted-out`, `consent-needed`, `in-frame`, `secret-key`, `switched-off`).
- **Capacitor, Ionic and other WebView apps** serve their pages from `localhost`, so a hosts list leaves
  the app out. Pass `hosts: ['localhost']` only when running inside the app
  (`window.Capacitor?.isNativePlatform?.()`), and give the app its own `appId` so web and app are separate
  in the dashboard. See the README, "In a Capacitor app".
- **Name screens the same everywhere.** `/app/ride-review`, `/ride_review.html` and the phone app's copy
  were one screen; `screenName: (path) => …` folds them together so funnels and heatmaps add up.
- **Skip admin pages** with `excludePaths`, or by not loading Recap there at all.

## Opt-out that actually works

- Give users a switch that calls `Recap.optOut()` (and `Recap.optIn()` to turn it back on). Recap stops at
  once, deletes what it hadn't sent and stops in every other open tab.
- If your site already has an "analytics off" flag that Google Analytics or other scripts read, keep using
  it: set it from the same switch, and if a page loads Recap only when the flag is clear, also listen for
  the flag changing in other tabs (`storage` event) and call `optOut()`.
- Reading `localStorage` can throw (blocked storage, some private modes). Wrap it, and treat a throw as
  "no stored choice".
- Global Privacy Control is respected by default. Leave it on.

## Recordings: size and storage

Measured on WattPlan's live pages with Recap 1.3:

- A multi-page site sends a **full snapshot on every page load**: 110 to 200 KB for typical pages, 450 to
  750 KB for a page with hundreds of inline SVGs. About 75 to 90 KB of each is the page's inlined CSS.
  Single-page apps send one snapshot and then small changes.
- After the snapshot, scrolling and taps add a few KB a minute.
- `<canvas>` charts only replay with `recordings.canvas` (`data-record-canvas="true"`): about 25 KB a
  picture, sent only when a chart changes.
- A typical five-page visit is **1 to 2 MB**. WattPlan's traffic recording every visit was about 15 MB a day.

That is why the database has separate limits for recordings: new recordings stop at **300 MB** in all and
each visit's recording at **10 MB**, while visits keep being counted up to 400 MB. Change them on the
dashboard's Storage page, and watch its recordings meter in the first weeks.

- **Per-tab sampling is sticky.** Recap decides once per tab whether to record and keeps the answer in
  `sessionStorage` (`recap-remote-rec`). Raising the sample rate doesn't change tabs that are already open.
  WattPlan cleared a stored `'0'` when it moved to recording every visit.
- **Pages that must never be recorded** (WattPlan's coach tools) can still be counted: start Recap without
  `recordings` on those screens.

## Hosting the script

- The CDN tag with `integrity` is the easiest. Keep `recap.min.js` and `recap-rrweb.min.js` side by side
  wherever they're served: Recap loads the recorder from beside itself, and only in tabs it records.
- **Vendor the files** when the site has no build step, or for an app that must work offline: copy both
  files and `LICENSE` from a release tag, and pin their sha384 hashes in a test so an accidental change
  fails the build.
- A local copy needs no Content-Security-Policy change. With the CDN, `script-src` must allow the folder,
  and `connect-src` your Supabase URL.

## The dashboard

- Open it in its own tab, not in a frame inside your admin area: Supabase sign-in is unreliable inside a
  third-party iframe. A link from your admin sidebar is enough; who can see data is decided by the
  dashboard's sign-in and the Team page, not by the link.
- Set Supabase's **Site URL** and **Redirect URLs** to the dashboard's address, or sign-in emails point at
  localhost.
- The Sessions list marks recorded visits and lists them first. A visit with no recording says why: not
  picked by the sample rate, or recordings had reached their limit.

## Custom events

- Fire them where the outcome is certain (after a save succeeds, not on the button press).
- Allow a fixed list of event names and properties, and drop anything else. Never send free text, names,
  emails or ids. WattPlan's tests feed names and emails into `track()` to prove they're dropped.
- Things that happen on a server (a webhook syncing a ride) can't be browser events. Count the
  in-app equivalent instead.

## Phone apps and store labels

- An app build without recordings is "Product Interaction, Analytics, not linked to the user, not used for
  tracking" on the App Store, and "App activity → App interactions, Analytics" on Google Play.
- **Recordings change the answers.** If recorded screens show the user's name or email, the data on them
  is linked to the user, and every data type a recorded screen shows (name, email, health, location,
  messages, purchases) needs Analytics added as a purpose. Stage the labels and `PrivacyInfo.xcprivacy`
  together before the build goes to review.
- Opt-out versus opt-in is a legal judgement for the owner, not the developer. In the UK the Data (Use
  and Access) Act 2025 adds an exception for analytics that only improves the service, provided users are
  told and can object easily; EU users still need consent. Use `requireConsent: true` and call
  `Recap.optIn()` from a consent prompt where you need opt-in. This is not legal advice.
