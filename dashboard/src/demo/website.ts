// A sample website for the demo ("demo-site"): a long landing page visited from phones and desktops,
// with taps where they would land on the page, scroll depth, and a page recording (an rrweb full
// snapshot) for every second visit, so the web heatmap has a real page to draw on.
//
// The page's CSS uses fixed heights, so the generator knows where every element is for any window.

import type { EventRow, SessionRow } from '../lib/types';

export interface DomRow {
  id: number;
  session_id: string;
  app_id: string;
  t_ms: number;
  events: { type: number; timestamp: number; data: unknown }[];
}

const APP = 'demo-site';

// ---------------------------------------------------------------- the page, as rrweb serializes it

interface Node {
  type: number;
  id: number;
  [k: string]: unknown;
}

function page(): Node {
  let id = 1;
  const text = (t: string, isStyle = false): Node => ({ type: 3, textContent: t, id: id++, ...(isStyle ? { isStyle: true } : {}) });
  const el = (tagName: string, attributes: Record<string, string> = {}, ...kids: (Node | string)[]): Node => ({
    type: 2,
    tagName,
    attributes,
    childNodes: kids.map((k) => (typeof k === 'string' ? text(k) : k)),
    id: id++,
  });
  const card = (title: string, price: string, cls: string, label: string) =>
    el('div', { class: `card ${cls}` }, el('h3', {}, title), el('div', { class: 'price' }, price), el('p', {}, 'Everything in the plan below, and more.'), el('a', { class: 'btn', href: '#', 'data-ut-label': label }, label));
  const css = `*{box-sizing:border-box;margin:0;padding:0}
body{font:16px/1.4 system-ui,sans-serif;color:#1d2330;background:#fff;padding-bottom:64px}
header{position:sticky;top:0;height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:#fff;border-bottom:1px solid #e5e7eb;z-index:5}
.logo{font-weight:800;font-size:20px}
#menu{width:48px;height:40px;border:1px solid #d0d5dd;border-radius:8px;background:#fff}
.hero{position:relative;min-height:100vh;background:linear-gradient(#eef4ff,#fff);padding:96px 24px 0}
.hero h1{font-size:34px;line-height:1.15;height:120px}
.hero p{height:80px;color:#475467}
#cta-hero{position:absolute;left:24px;right:24px;top:420px;height:52px;display:grid;place-items:center;background:#2f6fde;color:#fff;border-radius:12px;font-weight:700;text-decoration:none}
.hero .link{position:absolute;left:24px;top:548px;height:32px;color:#2f6fde}
#features{height:660px;padding:0 24px}
#features .card{height:200px;margin-bottom:20px;border-radius:16px;background:#f2f4f7;padding:20px}
#pricing{padding:0 24px;height:1140px}
#pricing h2{height:60px;font-size:28px;padding-top:12px}
#pricing .card{position:relative;height:340px;margin-bottom:20px;border:1px solid #e4e7ec;border-radius:16px;padding:20px}
#pricing h3{height:28px}
.price{font-size:32px;font-weight:800;margin-top:12px;height:48px}
#pricing .btn{position:absolute;left:20px;right:20px;bottom:28px;height:52px;display:grid;place-items:center;border-radius:12px;background:#1d2330;color:#fff;text-decoration:none}
#faq{height:400px;padding:0 24px}
#faq summary{height:100px;display:flex;align-items:center;border-bottom:1px solid #e4e7ec;cursor:pointer}
footer{height:200px;background:#1d2330;color:#fff;padding:32px 24px}
footer a{color:#cbd5e1;display:block;height:32px}
.bar{position:fixed;left:0;right:0;bottom:0;height:64px;background:#fff;border-top:1px solid #e4e7ec;padding:8px 16px}
.bar a{display:grid;place-items:center;height:48px;background:#2f6fde;color:#fff;border-radius:12px;text-decoration:none;font-weight:700}
@media (min-width:1024px){
body{padding-bottom:0}
header{height:72px;padding:0 120px}
.bar{display:none}
.hero{padding:140px 120px 0}
.hero h1{font-size:56px;height:150px;max-width:760px}
#cta-hero{left:120px;right:auto;width:240px;top:460px;height:56px}
.hero .link{left:120px;top:540px}
#features{display:flex;gap:24px;height:400px;padding:40px 120px}
#features .card{flex:1;height:320px;margin:0}
#pricing{display:grid;grid-template-columns:repeat(3,1fr);gap:0 24px;height:600px;padding:0 120px}
#pricing h2{grid-column:1/-1;height:80px}
#pricing .card{height:500px;margin:0}
#faq{padding:0 120px}
}`;
  const html = el(
    'html',
    { lang: 'en' },
    el('head', {}, el('meta', { charset: 'utf-8' }), el('title', {}, 'Trailhead: shoes for the hills'), el('style', {}, text(css, true))),
    el(
      'body',
      {},
      el('header', {}, el('div', { class: 'logo' }, 'Trailhead'), el('button', { id: 'menu', 'aria-label': 'Menu' }, '☰')),
      el(
        'section',
        { class: 'hero' },
        el('h1', {}, 'Shoes that grip the hill and not your toes'),
        el('p', {}, 'Light, wide-fitting trail shoes, made to be run in from the first mile.'),
        el('a', { id: 'cta-hero', href: '#' }, 'Start your free trial'),
        el('a', { class: 'link', href: '#pricing' }, 'See pricing'),
      ),
      el('section', { id: 'features' }, ...['Grip on wet rock', 'Wide toe box', 'Recycled uppers'].map((t) => el('div', { class: 'card' }, el('h3', {}, t)))),
      el('section', { id: 'pricing' }, el('h2', {}, 'Pick a plan'), card('Basic', '£5', 'basic', 'Choose Basic'), card('Pro', '£12', 'pro', 'Choose Pro'), card('Team', '£30', 'team', 'Choose Team')),
      el('section', { id: 'faq' }, ...['Do they run small?', 'Can I return them?', 'Are they waterproof?', 'Where are they made?'].map((q) => el('details', {}, el('summary', {}, q), el('p', {}, 'Yes.')))),
      el('footer', {}, el('a', { href: '#' }, 'About'), el('a', { href: '#' }, 'Contact'), el('a', { href: '#' }, 'Privacy')),
      el('div', { class: 'bar' }, el('a', { href: '#', 'data-ut-label': 'Get started (bar)' }, 'Get started')),
    ),
  );
  return { type: 0, id: id++, childNodes: [{ type: 1, name: 'html', publicId: '', systemId: '', id: id++ }, html] };
}

// ---------------------------------------------------------------- where things are, for a window

interface Box {
  selector: string;
  label: string | null;
  tag: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Pinned to the bottom of the window. */
  pinned?: boolean;
}

function layout(vw: number, vh: number): { boxes: Record<string, Box>; height: number } {
  const desk = vw >= 1024;
  const head = desk ? 72 : 56;
  const s1 = head + vh;
  const boxes: Record<string, Box> = {};
  const add = (k: string, b: Box) => (boxes[k] = b);
  add('menu', { selector: '#menu', label: null, tag: 'BUTTON', x0: vw - (desk ? 168 : 64), x1: vw - (desk ? 120 : 16), y0: head / 2 - 20, y1: head / 2 + 20 });
  add('cta', desk
    ? { selector: '#cta-hero', label: null, tag: 'A', x0: 120, x1: 360, y0: head + 460, y1: head + 516 }
    : { selector: '#cta-hero', label: null, tag: 'A', x0: 24, x1: vw - 24, y0: head + 420, y1: head + 472 });
  add('link', { selector: 'section.hero > a.link', label: null, tag: 'A', x0: desk ? 120 : 24, x1: (desk ? 120 : 24) + 90, y0: head + (desk ? 540 : 548), y1: head + (desk ? 572 : 580) });
  const s2 = s1 + (desk ? 400 : 660);
  for (let i = 0; i < 3; i++) {
    const colW = desk ? (vw - 240 - 48) / 3 : vw - 48;
    const x0 = desk ? 120 + i * (colW + 24) : 24;
    const fy = desk ? s1 + 40 : s1 + i * 220;
    add(`feature${i}`, { selector: `#features > div:nth-of-type(${i + 1})`, label: null, tag: 'DIV', x0, x1: x0 + colW, y0: fy, y1: fy + (desk ? 320 : 200) });
    const cy = desk ? s2 + 80 : s2 + 60 + i * 360;
    const plan = ['Basic', 'Pro', 'Team'][i]!;
    add(`plan${i}`, { selector: `[data-ut-label="Choose ${plan}"]`, label: `Choose ${plan}`, tag: 'A', x0: x0 + 20, x1: x0 + colW - 20, y0: cy + (desk ? 420 : 260), y1: cy + (desk ? 472 : 312) });
    add(`price${i}`, { selector: `#pricing > div.${plan.toLowerCase()} > div`, label: null, tag: 'DIV', x0: x0 + 20, x1: x0 + 120, y0: cy + 60, y1: cy + 108 });
  }
  const s3 = s2 + (desk ? 600 : 1140);
  for (let i = 0; i < 4; i++)
    add(`faq${i}`, { selector: `#faq > details:nth-of-type(${i + 1}) > summary`, label: null, tag: 'SUMMARY', x0: desk ? 120 : 24, x1: vw - (desk ? 120 : 24), y0: s3 + i * 100, y1: s3 + i * 100 + 100 });
  const s4 = s3 + 400;
  for (let i = 0; i < 3; i++)
    add(`foot${i}`, { selector: `footer > a:nth-of-type(${i + 1})`, label: null, tag: 'A', x0: 24, x1: 140, y0: s4 + 32 + i * 32, y1: s4 + 60 + i * 32 });
  if (!desk) add('bar', { selector: '[data-ut-label="Get started (bar)"]', label: 'Get started (bar)', tag: 'A', x0: 16, x1: vw - 16, y0: vh - 56, y1: vh - 8, pinned: true });
  return { boxes, height: s4 + 200 + (desk ? 0 : 64) };
}

// ---------------------------------------------------------------- visits

function rng(seed: number) {
  let x = seed;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}

const uuid = (r: () => number) =>
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(r() * 16).toString(16));

const WINDOWS = [
  { w: 390, h: 844, model: 'iPhone', os: 'iOS 18', weight: 0.3 },
  { w: 375, h: 812, model: 'iPhone', os: 'iOS 17', weight: 0.15 },
  { w: 412, h: 915, model: 'Android', os: 'Android 15', weight: 0.2 },
  { w: 820, h: 1180, model: 'iPad', os: 'iPadOS 18', weight: 0.05 },
  { w: 1440, h: 900, model: 'Mac', os: 'macOS', weight: 0.18 },
  { w: 1280, h: 720, model: 'Windows', os: 'Windows 11', weight: 0.07 },
  { w: 1920, h: 1080, model: 'Windows', os: 'Windows 11', weight: 0.05 },
];

export function buildWebsite(now: number): { sessions: SessionRow[]; events: EventRow[]; dom: DomRow[] } {
  const r = rng(424242);
  const doc = page();
  const sessions: SessionRow[] = [];
  const events: EventRow[] = [];
  const dom: DomRow[] = [];
  let eid = 900000;
  let did = 1;
  for (let n = 0; n < 140; n++) {
    let pick = r();
    const win = WINDOWS.find((w) => (pick -= w.weight) <= 0) ?? WINDOWS[0]!;
    const { w: vw, h: vh } = win;
    const { boxes, height } = layout(vw, vh);
    const maxScroll = Math.max(0, height - vh);
    const id = uuid(r);
    const start = now - Math.floor(r() * 6 * 86_400_000) - 3_600_000;
    let t = 0;
    const evs: EventRow[] = [];
    const push = (type: EventRow['type'], screen: string, data: Record<string, unknown>) =>
      evs.push({ id: eid++, session_id: id, type, t_ms: t, at: new Date(start + t).toISOString(), screen, data });
    push('screen', '/', { from: null, method: 'pageload' });
    // How far this visit scrolls: most look at the top, fewer reach the plans, fewer the end.
    const reachRoll = r();
    const deepest = reachRoll < 0.22 ? 0 : reachRoll < 0.5 ? 0.3 : reachRoll < 0.72 ? 0.6 : reachRoll < 0.88 ? 0.85 : 1;
    const maxY = Math.round(deepest * maxScroll);
    let shownDepth = 0;
    const scrollTo = (y: number) => {
      const depth = maxScroll ? Math.round((Math.min(y, maxY) / maxScroll) * 100) : 100;
      for (const m of [25, 50, 75, 100]) if (shownDepth < m && depth >= m) push('scroll', '/', { depth: m, maxDepth: depth });
      shownDepth = Math.max(shownDepth, depth);
      return Math.min(y, maxY);
    };
    let last: { x: number; py: number; scrollY: number } | null = null;
    const tap = (k: string, gap = 1500, spread = 2500, again = false) => {
      const b = boxes[k];
      if (!b) return false;
      const x = again && last ? last.x + Math.round((r() - 0.5) * 8) : Math.round(b.x0 + (b.x1 - b.x0) * (0.2 + r() * 0.6));
      let clientY: number;
      let scrollY: number;
      if (b.pinned) {
        scrollY = Math.round(r() * maxY);
        clientY = Math.round(b.y0 + (b.y1 - b.y0) * (0.2 + r() * 0.6));
      } else {
        const py = again && last ? last.py + (r() - 0.5) * 8 : b.y0 + (b.y1 - b.y0) * (0.2 + r() * 0.6);
        if (py > maxY + vh) return false; // never scrolled that far
        scrollY = again && last ? last.scrollY : Math.min(maxY, Math.max(0, Math.round(py - vh * (0.3 + r() * 0.4))));
        clientY = Math.round(py - scrollY);
        last = { x, py, scrollY };
      }
      t += gap + Math.floor(r() * spread);
      scrollTo(scrollY);
      push('tap', '/', {
        x,
        y: clientY,
        nx: +(x / vw).toFixed(4),
        ny: +(clientY / vh).toFixed(4),
        label: b.label,
        selector: b.selector,
        tag: b.tag,
        pageY: clientY + scrollY,
      });
      return true;
    };
    const phone = vw < 600;
    if (r() < 0.12) tap('menu', 400);
    if (r() < 0.3) tap('cta');
    else if (r() < 0.2) tap('link');
    if (r() < 0.18) tap(`feature${Math.floor(r() * 3)}`);
    const plan = r() < 0.55 ? 1 : r() < 0.6 ? 0 : 2;
    if (r() < 0.45) tap(`plan${plan}`);
    // The Team price looks like a button and isn't: some tap it again and again.
    if (r() < 0.12 && tap('price2')) for (let k = 0; k < 3; k++) tap('price2', 150, 150, true);
    if (r() < 0.25) tap(`faq${Math.floor(r() * 4)}`);
    if (r() < 0.08) tap(`foot${Math.floor(r() * 3)}`);
    if (phone && r() < 0.3) tap('bar');
    scrollTo(maxY);
    t += 2000;
    const signup = evs.some((e) => e.type === 'tap' && (e.data.selector === '#cta-hero' || String(e.data.label ?? '').startsWith('Choose')));
    if (signup) {
      push('screen', '/signup', { from: '/', method: 'pushState' });
      t += 1800;
      push('tap', '/signup', { x: Math.round(vw / 2), y: 220, nx: 0.5, ny: +(220 / vh).toFixed(4), label: null, selector: '#email', tag: 'INPUT', pageY: 220 });
      if (r() < 0.6) {
        t += 3000;
        push('tap', '/signup', { x: Math.round(vw / 2), y: 380, nx: 0.5, ny: +(380 / vh).toFixed(4), label: 'Create account', selector: '[data-ut-label="Create account"]', tag: 'BUTTON', pageY: 380 });
        push('custom', '/signup', { name: 'signed_up', plan: ['basic', 'pro', 'team'][plan] });
      }
    }
    const recorded = n % 2 === 0;
    let domBytes = 0;
    if (recorded) {
      const chunk: DomRow = {
        id: did++,
        session_id: id,
        app_id: APP,
        t_ms: 40,
        events: [
          { type: 4, timestamp: start + 40, data: { href: 'https://trailhead.example/', width: vw, height: vh } },
          { type: 2, timestamp: start + 41, data: { node: doc, initialOffset: { top: 0, left: 0 } } },
        ],
      };
      domBytes = JSON.stringify(chunk.events).length;
      dom.push(chunk);
    }
    const screens = evs.filter((e) => e.type === 'screen');
    sessions.push({
      id,
      app_id: APP,
      started_at: new Date(start).toISOString(),
      last_seen_at: new Date(start + t).toISOString(),
      user_id: null,
      anonymous_id: uuid(r),
      platform: 'web',
      os_version: win.os,
      device_model: win.model,
      app_version: null,
      locale: 'en-GB',
      screen_width: vw,
      screen_height: vh,
      sdk_version: 'web-0.3.0',
      event_count: evs.length,
      tap_count: evs.filter((e) => e.type === 'tap').length,
      screen_count: screens.length,
      first_screen: screens[0]?.screen ?? null,
      last_screen: screens[screens.length - 1]?.screen ?? null,
      replay_bytes: 0,
      dom_bytes: domBytes,
      has_recording: recorded,
    });
    events.push(...evs);
  }
  return { sessions, events, dom };
}
