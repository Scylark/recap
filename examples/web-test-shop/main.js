// Recap web test shop: a small single-page shop with dropdowns, a popover menu, chips, steppers,
// an accordion, a promo code that always fails and a validated checkout form. Every page view, tap
// and scroll goes to your Recap dashboard, and the page itself is recorded for replay with rrweb.

import Recap from 'recap-ux';
import { record } from 'rrweb';

Recap.init({
  appId: 'web-test-shop',
  supabase: { url: import.meta.env.VITE_RECAP_SUPABASE_URL, anonKey: import.meta.env.VITE_RECAP_SUPABASE_ANON_KEY },
  recordings: { record },
  appVersion: '1.0.0',
  debug: true,
});

const PRODUCTS = [
  { id: 'TRAIL-1', name: 'Trail Shoe', price: 95, cat: 'Trail', badge: 'Bestseller', colour: '#4b6f8c' },
  { id: 'ROAD-1', name: 'Road Racer', price: 120, cat: 'Road', badge: 'New', colour: '#a0522d' },
  { id: 'HIKE-1', name: 'Hike Boot', price: 140, cat: 'Hiking', badge: null, colour: '#6b7f3a' },
  { id: 'TRAIL-2', name: 'Fell Runner', price: 110, cat: 'Trail', badge: null, colour: '#7a5c8f' },
  { id: 'ROAD-2', name: 'Tempo Trainer', price: 85, cat: 'Road', badge: 'Sale', colour: '#2f7a6d' },
  { id: 'HIKE-2', name: 'Summit Mid', price: 160, cat: 'Hiking', badge: null, colour: '#8c6b3f' },
];
const SIZES = ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11'];
const COLOURS = ['Teal', 'Sand', 'Black'];

const state = { category: 'All', sort: 'popular', basket: [] };
const app = document.getElementById('app');
const money = (n) => `£${n.toFixed(2)}`;
const h = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function go(path) {
  history.pushState({}, '', path);
  render();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a) {
    e.preventDefault();
    go(a.getAttribute('href'));
  }
});
window.addEventListener('popstate', render);

function updateCount() {
  document.getElementById('count').textContent = String(state.basket.reduce((n, i) => n + i.qty, 0));
}

// ---------------------------------------------------------------- pages

function home() {
  const sortLabels = { popular: 'Most popular', low: 'Price: low to high', high: 'Price: high to low' };
  let list = PRODUCTS.filter((p) => state.category === 'All' || p.cat === state.category);
  if (state.sort === 'low') list = [...list].sort((a, b) => a.price - b.price);
  if (state.sort === 'high') list = [...list].sort((a, b) => b.price - a.price);
  app.innerHTML = `
    <section class="hero">
      <h1>Winter sale</h1>
      <p>Up to 30% off trail shoes this week</p>
      <button class="btn" id="shop-now">Shop now</button>
    </section>
    <div class="chips" role="group" aria-label="Category">
      ${['All', 'Trail', 'Road', 'Hiking'].map((c) => `<button class="chip ${c === state.category ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}
    </div>
    <div class="menu-wrap">
      <span class="label">Sort by</span>
      <button class="select" id="sort-btn" aria-haspopup="menu">${sortLabels[state.sort]} ▾</button>
      <div class="menu" id="sort-menu" role="menu" hidden>
        ${Object.entries(sortLabels).map(([k, v]) => `<button role="menuitem" data-sort="${k}" class="${k === state.sort ? 'on' : ''}">${v}</button>`).join('')}
      </div>
    </div>
    <div class="grid">
      ${list
        .map(
          (p) => `
        <a class="card" href="/product/${p.id}" data-link aria-label="Product card: ${h(p.name)}">
          <div class="pic" style="background:${p.colour}">👟</div>
          <div class="card-body"><strong>${h(p.name)}</strong> ${p.badge ? `<span class="badge">${p.badge}</span>` : ''}<span class="price">${money(p.price)}</span></div>
        </a>`,
        )
        .join('')}
    </div>
    <section class="info">
      <h2>Why shop with us</h2>
      <p>Free returns for 60 days. Every shoe is tested on real trails, roads and hills before it reaches the shop.</p>
      <p>Not sure about your size? Each product page has a size guide, and you can swap sizes for free.</p>
    </section>`;
  app.querySelector('#shop-now').onclick = () => {
    state.category = 'Trail';
    render();
  };
  app.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => ((state.category = b.dataset.cat), render())));
  const menu = app.querySelector('#sort-menu');
  app.querySelector('#sort-btn').onclick = () => (menu.hidden = !menu.hidden);
  menu.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => ((state.sort = b.dataset.sort), render())));
}

function product(id) {
  const p = PRODUCTS.find((x) => x.id === id) ?? PRODUCTS[0];
  let qty = 1;
  let colour = COLOURS[0];
  app.innerHTML = `
    <a href="/" data-link class="back">← Back to shop</a>
    <div class="product">
      <div class="pic big" style="background:${p.colour}">👟</div>
      <div>
        <h1>${h(p.name)}</h1>
        <p class="price">${money(p.price)}</p>
        <p>Light, grippy and comfortable from the first run. Tested on wet rock, mud and tarmac.</p>
        <label class="label" for="size">Size</label>
        <select id="size" class="select"><option value="">Choose your size</option>${SIZES.map((s) => `<option>${s}</option>`).join('')}</select>
        <p class="error" id="size-error" hidden>Please choose a size</p>
        <span class="label">Colour</span>
        <div class="chips">${COLOURS.map((c) => `<button class="chip ${c === colour ? 'on' : ''}" data-colour="${c}">Colour: ${c}</button>`).join('')}</div>
        <span class="label">Quantity</span>
        <div class="stepper"><button id="minus" aria-label="Fewer">−</button><span id="qty">1</span><button id="plus" aria-label="More">+</button></div>
        <button class="btn wide" id="add">Add to basket</button>
        <details class="acc"><summary>Reviews (3)</summary>
          <p>★★★★★ "Best trail shoe I've owned." — Sam</p>
          <p>★★★★☆ "Runs a bit small, go up half a size." — Priya</p>
          <p>★★★★★ "Grip is unreal in the wet." — Tom</p>
        </details>
        <details class="acc"><summary>Size guide</summary><p>If you're between sizes, go up. UK 8 fits a 26.5 cm foot.</p></details>
      </div>
    </div>`;
  const sizeEl = app.querySelector('#size');
  sizeEl.onchange = () => {
    app.querySelector('#size-error').hidden = true;
    if (sizeEl.value) Recap.track('size_selected', { sku: p.id, size: sizeEl.value });
  };
  app.querySelectorAll('[data-colour]').forEach(
    (b) =>
      (b.onclick = () => {
        colour = b.dataset.colour;
        app.querySelectorAll('[data-colour]').forEach((x) => x.classList.toggle('on', x === b));
      }),
  );
  const show = () => (app.querySelector('#qty').textContent = String(qty));
  app.querySelector('#minus').onclick = () => ((qty = Math.max(1, qty - 1)), show());
  app.querySelector('#plus').onclick = () => ((qty = Math.min(9, qty + 1)), show());
  app.querySelector('#add').onclick = () => {
    if (!sizeEl.value) {
      app.querySelector('#size-error').hidden = false;
      return;
    }
    state.basket.push({ sku: p.id, name: p.name, price: p.price, size: sizeEl.value, colour, qty });
    Recap.track('added_to_basket', { sku: p.id, size: sizeEl.value, colour, qty, value: p.price * qty });
    updateCount();
    go('/basket');
  };
}

function basket() {
  const subtotal = state.basket.reduce((n, i) => n + i.price * i.qty, 0);
  app.innerHTML = `
    <h1>Basket</h1>
    ${
      state.basket.length === 0
        ? '<p class="muted">Your basket is empty. <a href="/" data-link>Keep shopping</a></p>'
        : state.basket
            .map(
              (i, n) => `
      <div class="line">
        <div><strong>${h(i.name)}</strong><br><span class="muted">${h(i.size)} · ${h(i.colour)}</span></div>
        <div class="stepper small"><button data-dec="${n}" aria-label="Fewer">−</button><span>${i.qty}</span><button data-inc="${n}" aria-label="More">+</button></div>
        <div>${money(i.price * i.qty)}</div>
        <button class="link" data-remove="${n}">Remove</button>
      </div>`,
            )
            .join('')
    }
    <div class="promo">
      <label class="label" for="promo">Promo code</label>
      <div class="row"><input id="promo" placeholder="e.g. WINTER10" /><button class="btn ghost" id="apply">Apply</button></div>
      <p class="error" id="promo-msg" hidden></p>
    </div>
    <p class="total">Subtotal <strong>${money(subtotal)}</strong></p>
    <button class="btn wide" id="checkout" ${state.basket.length ? '' : 'disabled'}>Checkout</button>`;
  app.querySelectorAll('[data-inc]').forEach((b) => (b.onclick = () => ((state.basket[b.dataset.inc].qty += 1), render())));
  app.querySelectorAll('[data-dec]').forEach(
    (b) => (b.onclick = () => ((state.basket[b.dataset.dec].qty = Math.max(1, state.basket[b.dataset.dec].qty - 1)), render())),
  );
  app.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => (state.basket.splice(b.dataset.remove, 1), updateCount(), render())));
  app.querySelector('#apply').onclick = () => {
    const msg = app.querySelector('#promo-msg');
    msg.hidden = false;
    msg.textContent = 'That code has expired.';
    Recap.track('promo_failed');
  };
  app.querySelector('#checkout').onclick = () => go('/checkout');
}

function checkout() {
  const total = state.basket.reduce((n, i) => n + i.price * i.qty, 0);
  app.innerHTML = `
    <h1>Checkout</h1>
    <form id="form" novalidate class="recap-form">
      <label class="label" for="name">Full name</label><input id="name" autocomplete="name" />
      <label class="label" for="email">Email</label><input id="email" type="email" autocomplete="email" />
      <label class="label" for="postcode">Postcode</label><input id="postcode" autocomplete="postal-code" />
      <label class="label" for="delivery">Delivery</label>
      <select id="delivery" class="select">
        <option value="standard">Standard (3–5 days) — free</option>
        <option value="express">Express (next day) — £6.00</option>
        <option value="collect">Click and collect — free</option>
      </select>
      <label class="check"><input type="checkbox" id="gift" /> Gift wrap (£3.00)</label>
      <label class="check"><input type="checkbox" id="news" /> Send me offers by email</label>
      <p class="error" id="form-error" hidden></p>
      <button class="btn wide" type="submit">Place order · ${money(total)}</button>
    </form>`;
  app.querySelector('#form').onsubmit = (e) => {
    e.preventDefault();
    const name = app.querySelector('#name').value.trim();
    const email = app.querySelector('#email').value.trim();
    const postcode = app.querySelector('#postcode').value.trim();
    const err = !name ? 'Please enter your name' : !/^\S+@\S+\.\S+$/.test(email) ? 'Please enter a valid email' : !postcode ? 'Please enter your postcode' : null;
    const el = app.querySelector('#form-error');
    if (err) {
      el.hidden = false;
      el.textContent = err;
      Recap.track('checkout_error', { reason: err });
      return;
    }
    Recap.track('order_completed', {
      value: total,
      items: state.basket.length,
      delivery: app.querySelector('#delivery').value,
      gift_wrap: app.querySelector('#gift').checked,
    });
    state.basket = [];
    updateCount();
    go('/confirmation');
  };
}

function confirmation() {
  app.innerHTML = `
    <div class="done">
      <h1>Thanks for your order</h1>
      <p>We've sent a confirmation email. (Not really, this is a test shop.)</p>
      <p class="label">How was shopping with us?</p>
      <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" aria-label="${n} stars">★</button>`).join('')}</div>
      <p id="thanks" class="muted" hidden>Thanks for the feedback!</p>
      <a href="/" data-link class="btn ghost">Back to the shop</a>
    </div>`;
  app.querySelectorAll('[data-star]').forEach(
    (b) =>
      (b.onclick = () => {
        const n = Number(b.dataset.star);
        app.querySelectorAll('[data-star]').forEach((x) => x.classList.toggle('on', Number(x.dataset.star) <= n));
        app.querySelector('#thanks').hidden = false;
        Recap.track('rating', { stars: n });
      }),
  );
}

function render() {
  const path = location.pathname;
  if (path.startsWith('/product/')) product(path.split('/')[2]);
  else if (path === '/basket') basket();
  else if (path === '/checkout') checkout();
  else if (path === '/confirmation') confirmation();
  else home();
}

render();
