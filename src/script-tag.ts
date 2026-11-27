// Starting Recap from its <script> tag: finds the tag and reads its data-* attributes.
// Used only by the script-tag build (src/browser.ts → dist/recap.min.js). Importing recap-ux as a
// module never starts anything on its own.

import type { RecapConfig } from './types.js';
import { Recap, setScriptDefaults } from './index.js';

/** Recap's own built file names: recap.js, recap.min.js, recap.umd.js. */
const OWN_FILE = /(^|\/)recap(\.min|\.umd)?\.js$/i;
/** The package itself on a CDN, e.g. https://unpkg.com/recap-ux@1.2.0 */
const OWN_PACKAGE = /(^|\/)recap-ux(@[^/]*)?\/?$/i;

/**
 * Whether a script tag loads Recap: it has a data-recap attribute, or its file is one of Recap's
 * own. Other scripts with "recap" in their address (Google's recaptcha__en.js) don't count.
 */
export function isRecapScript(s: HTMLScriptElement): boolean {
  if (s.hasAttribute('data-recap')) return true;
  const src = s.getAttribute('src');
  if (!src) return false;
  let path: string;
  try {
    path = new URL(src, typeof location !== 'undefined' ? location.href : 'https://localhost').pathname;
  } catch {
    path = src.split(/[?#]/)[0] ?? src;
  }
  return OWN_FILE.test(path) || OWN_PACKAGE.test(path);
}

/** The tag that loaded Recap: the one running now, or else a tag that is clearly Recap's. */
export function findRecapScript(doc: Document = document): HTMLScriptElement | null {
  const current = doc.currentScript;
  if (current && current.tagName === 'SCRIPT') return current as HTMLScriptElement;
  const tagged = doc.querySelector<HTMLScriptElement>('script[data-recap]');
  if (tagged) return tagged;
  for (const s of Array.from(doc.querySelectorAll<HTMLScriptElement>('script[src]'))) {
    if (isRecapScript(s)) return s;
  }
  return null;
}

/** Settings from a script tag's data-* attributes. */
export function readScriptConfig(el: HTMLScriptElement): RecapConfig {
  const d = el.dataset;
  const config: RecapConfig = {};

  if (d['sessionName']) config.sessionName = d['sessionName'];
  if (d['showPanel'] === 'true') config.showPanel = true;
  if (d['panel'] === 'false') config.panel = false;
  if (d['endpoint']) config.endpoint = d['endpoint'];
  if (d['supabaseUrl'] && d['supabaseKey']) {
    config.supabase = { url: d['supabaseUrl'], anonKey: d['supabaseKey'] };
  }
  if (d['appId']) config.appId = d['appId'];
  if (d['appVersion']) config.appVersion = d['appVersion'];
  // Page recordings need rrweb loaded on the page first (window.rrweb).
  if (d['recordings'] === 'true') {
    const mask = d['maskText'];
    config.recordings = mask === 'true' ? { maskText: true } : mask ? { maskText: mask } : true;
  }
  if (d['labels'] === 'none' || d['labels'] === 'attributes' || d['labels'] === 'text') config.labels = d['labels'];
  if (d['requireConsent'] === 'true') config.requireConsent = true;
  if (d['debug'] === 'true') config.debug = true;
  if (d['shortcut']) config.shortcut = d['shortcut'] === 'false' ? false : d['shortcut'];
  if (d['stripQueryParams'] === 'false') config.stripQueryParams = false;
  if (d['touchTrigger'] === 'false') config.touchTrigger = false;
  if (d['touchTriggerFingers']) config.touchTriggerFingers = parseInt(d['touchTriggerFingers'], 10);
  if (d['touchTriggerHoldMs']) config.touchTriggerHoldMs = parseInt(d['touchTriggerHoldMs'], 10);

  return config;
}

/**
 * Start Recap from its script tag. With data-auto-init="false" it only remembers the tag's settings,
 * and starts when the page calls Recap.init() (to pass a screenName function, for example).
 */
export function autoInit(doc: Document = document): void {
  const script = findRecapScript(doc);
  const config = script ? readScriptConfig(script) : {};
  setScriptDefaults(config);
  if (script?.dataset['autoInit'] === 'false') return;
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', () => Recap.init(), { once: true });
  } else {
    Recap.init();
  }
}
