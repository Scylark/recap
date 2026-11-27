# Recap web test shop

A small single-page shop for trying Recap on the web: category chips, a popover sort menu, size and
delivery dropdowns, colour chips, quantity steppers, accordions, a promo code that always fails, a checkout
form with validation and a star rating. Every page view, click and scroll goes to your Recap dashboard,
and the page itself is recorded with rrweb for replay.

```bash
cp .env.example .env   # fill in your Supabase URL and public anon / publishable key
npm install
npm run dev            # http://localhost:3001, and on your phone at the Network address it prints
```

Your Supabase project needs every file in `supabase/migrations/`, including `*_recap_dom.sql` for replays.
Sessions show up in the dashboard under the app `web-test-shop`.
