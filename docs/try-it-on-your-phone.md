# Try Recap on your phone

About 20 minutes. You'll run a small test shop app on your phone, tap around, and watch your own session
appear in the Recap dashboard. Everything runs on free tiers.

You need: a phone, a computer on the same Wi-Fi with [Node.js](https://nodejs.org) 20 or newer, and a free
[Supabase](https://supabase.com) account.

## 1. Create the database (5 minutes)

1. Sign in at [supabase.com](https://supabase.com) and click **New project**. Any name, any password (you
   won't need it again), and the region closest to you.
2. When it's ready, open **SQL Editor** and run each file in [`supabase/migrations/`](../supabase/migrations/)
   in name order: paste the whole file, click **Run**, then do the next. There are three: sessions and
   events, analytics, and screen pictures. You should see "Success. No rows returned" each time.
3. Still in the SQL Editor, run this with your own email address. It makes you the dashboard's first admin:
   ```sql
   insert into public.recap_members (email, role) values ('you@example.com', 'admin');
   ```
4. Open **Project Settings, API** (or the **Connect** button) and copy two values:
   - **Project URL**, like `https://abcdefgh.supabase.co`
   - the **anon public** key, a long string starting `eyJ` (or `sb_publishable_` on newer projects)

   Both are safe to share and to put in an app. Never share the `service_role` or secret key.

## 2. Install the phone app Expo Go

Install **Expo Go** from the App Store or Google Play. It runs apps straight from your computer, with
nothing to publish.

## 3. Start the test shop on your computer

```bash
git clone https://github.com/Scylark/recap.git
cd recap
git checkout mobile-sdk            # until the pull request is merged

cd examples/expo-test-shop
cp .env.example .env               # then paste your Project URL and anon key into .env
npm install
npm start
```

A QR code appears in the terminal. On iPhone, scan it with the Camera app. On Android, scan it from inside
Expo Go. The Test Shop opens on your phone.

If the phone can't connect, your Wi-Fi may block devices from seeing each other: stop it with Ctrl+C and run
`npx expo start --tunnel` instead.

## 4. Use the app like a customer

Tap **Shop now**, scroll down the product page, tap **Add to basket**, then tap **Checkout** a few times.
Try sending the app to the background and coming back. Wait about ten seconds so the last events upload.

## 5. Open the dashboard

In a second terminal window, from the `recap` folder:

```bash
cd dashboard
cp .env.example .env.local         # paste the same Project URL and anon key
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter the email you added in step 1.3, and click the
sign-in link Supabase emails you. Your session should be on the Overview and Sessions pages. Open it, look
at the tap heatmap, and try **Copy AI summary** into Claude.

## What to look out for

- Does every screen you visited show up, in order?
- Are the taps on the right buttons, named "Shop now", "Add to basket" and "Checkout"?
- Did the scroll on the product page register?
- Does the AI summary read like what you actually did?

## If something doesn't show up

- In `examples/expo-test-shop/App.js` the SDK runs with `debug: true`. Messages starting `[Recap]` in the
  terminal running `npm start` show each upload or error.
- "upload failed" usually means the URL or key in `.env` is wrong. Restart `npm start` after fixing it.
- Signed in but "No access yet"? The email you signed in with must match the one in step 1.3 exactly.
- The sign-in email opens a page that won't load? In Supabase, **Authentication, URL Configuration**,
  set **Site URL** to `http://localhost:3000`.
