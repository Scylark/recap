# Security

Recap has no server of its own: sites and apps write straight into the owner's Supabase project, and the
dashboard is a static site that reads it. This page says what that means, what Recap does about it, and the
few settings an owner should check. Found a problem? Open a private
[security advisory](https://github.com/Scylark/recap/security/advisories/new) rather than an issue.

## How it fits together

| Part | Who can use it | What protects it |
| --- | --- | --- |
| Upload functions (`recap_ingest`, `recap_dom`, `recap_frames`, `recap_screenshot`) | **Anyone**: the publishable key ships in every page and app | They only add data, check every value's size and type, and stop at the storage limits |
| Tables | Signed-in team members only | Row level security: members read; admins delete and change settings. The public key reads nothing |
| Team list (`recap_members`) | Admins | Access needs an email on the list **and** confirmed in Supabase Auth |
| Dashboard | Team members | Supabase sign-in (PKCE), security headers (`vercel.json`, `netlify.toml`) |

Everything a recording or event contains was written by whoever held the public key, which may not be your
app. So the dashboard treats it as untrusted: replays run in rrweb's sandbox with scripts off, labels are
shown as text, one broken event can't blank a page, and "Copy AI summary" marks the data as untrusted and
shortens it before you paste it into an AI assistant.

## Owner checklist

1. **Only ever use the publishable (or anon) key.** Never the secret or `service_role` key, in a site, an app
   or the dashboard. The web library, the React Native SDK and the dashboard's Install page all refuse one.
   If one has been shipped, rotate it in Supabase straight away.
2. **Keep "Confirm email" on** (Supabase → Authentication → Sign In / Providers → Email). Recap ignores
   unconfirmed emails, but it's the first line of defence.
3. **Turn off new sign-ups once your team has signed in** (Authentication → Sign In / Providers → "Allow new
   users to sign up"). Invite later members from Supabase (Authentication → Users → Invite) and add them on
   the Team page. Anyone can otherwise create an account on your project; they see nothing, but there's no
   reason to let them in.
4. **Set the Site URL and Redirect URLs** (Authentication → URL Configuration) to the dashboard's address only.
5. **Leave the storage limits on** (Storage page). They are what stop someone with the public key filling your
   database: on Supabase's free plan a full database makes the whole project read-only. Recap counts real
   bytes and checks the limit on every upload.
6. **Use a separate Supabase project for Recap**, so a problem with analytics can never touch your app's data.
7. **If your Supabase project uses a custom domain,** add it to `connect-src` in `dashboard/vercel.json` (or
   `netlify.toml`), or the dashboard can't reach it.

## What someone with the public key can do

These are limits of a design where anyone can upload, not bugs. Recap keeps their cost bounded.

- **Send made-up visits** to any app id, until the daily limit (if you set one) or the storage limits stop
  them. Sampling (`session_sample`, `replay_sample`) is a cost control, not a defence: the sender picks the
  session id.
- **Add to a session whose id they know.** Session ids are random UUIDs and only appear in the dashboard, so
  keep dashboard links within your team.
- **Replace a heatmap screen picture** for an app version they know. Pictures are only a background for
  taps; if one looks wrong, delete it from the database and the next build's picture replaces it.
- **Make a replay load images or fonts from a server they control**, which tells them a team member opened
  it and from which IP address. Scripts never run in replays, forms can't be sent and the dashboard sends no
  referrer. For the strictest setting, change `img-src`, `style-src`, `font-src` and `media-src` in the
  dashboard's headers to `'self' data: blob:`; replays then show no images or web fonts from the recorded site.

## Privacy defaults that matter for security

- Typed text is never recorded: form fields, editable areas and hidden fields are masked, and token meta tags
  (CSRF) are blanked.
- Recorded addresses lose their query and hash, including links back to the same page, so reset and sign-in
  tokens in URLs don't reach the database.
- `data-recap-private` keeps an element out of recordings and taps. If one of your own selectors is invalid,
  Recap refuses to record rather than silently dropping the markers.
- The recorder (`recap-rrweb.min.js`) is checked against its hash when Recap loads it from beside itself.

## Review history

- **28 Nov 2026**: full review of the database, web library, dashboard and React Native SDK. Fixed: storage
  limits enforced on every upload with real byte counts, screen picture limits, confirmed emails for access,
  sane timestamps, batched clean-up, per-query access checks, one recording limit per visit with a lock,
  `forget_user` per app with the device's anonymous sessions, member email rules and a kept last admin,
  fewer table rights; dashboard security headers, PKCE sign-in, untrusted-data handling in the AI summary,
  error boundaries; recording privacy (same-page links, editable areas, hidden fields, CSRF tokens, invalid
  selectors), recorder integrity, safer tap labels and `track()`; React Native screen pictures re-checking
  privacy and consent, refusing secret keys, and stronger session ids.
