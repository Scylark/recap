// Starting Recap from its <script> tag: finds the tag and reads its data-* attributes.
// Used only by the script-tag build (src/browser.ts → dist/recap.min.js). Importing recap-ux as a
// module never starts anything on its own.

import type { RecapConfig, RemoteRecordingOptions } from './types.js';
import { Recap, setScriptDefaults } from './index.js';
import { setDefaultRrwebSrc } from './remote/remote.js';

/** Recap's own built file names: recap.js, recap.min.js, recap.umd.js. */
const OWN_FILE = /(^|\/)recap(\.min|\.umd)?\.js$/i;
/** The package itself on a CDN, e.g. https://unpkg.com/recap-ux@1.2.0 */
const OWN_PACKAGE = /(^|\/)recap-ux(@[^/]*)?\/?$/i;
/** rrweb's recorder, built next to recap.min.js. */
const RRWEB_FILE = 'recap-rrweb.min.js';

/**
 * Whether a script tag loads Recap: it has a data-recap attribute, or its file is one of Recap's
 * own. Other scripts with "recap" in their address (Google's recaptcha__en.js) don't count, and
 * neither do the privacy markers (data-recap-private, data-recap-mask): they are other attributes.
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

/**
 * Where recap-rrweb.min.js is, next to the Recap script: the same folder
 * (…/dist/recap.min.js → …/dist/recap-rrweb.min.js), or the package's dist folder when the tag
 * loads the package root (https://unpkg.com/recap-ux@1.3.0).
 */
export function rrwebNextTo(script: HTMLScriptElement | null): string | null {
  const src = script?.getAttribute('src');
  if (!src) return null;
  try {
    const url = new URL(src, typeof location !== 'undefined' ? location.href : undefined);
    if (OWN_PACKAGE.test(url.pathname)) {
      return `${url.origin}${url.pathname.replace(/\/?$/, '')}/dist/${RRWEB_FILE}`;
    }
    return new URL(RRWEB_FILE, url).href;
  } catch {
    return null;
  }
}

/** A comma-separated attribute as a list, without blanks. */
function list(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** An on/off attribute: present, "" or "true" is on, "false" is off. */
function flag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === '' || value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** Recording settings from data-recordings="true" and the data-record-* attributes. */
function recordingsFrom(d: DOMStringMap): true | RemoteRecordingOptions {
  const rec: RemoteRecordingOptions = {};
  const mask = d['maskText'];
  if (mask === 'true') rec.maskText = true;
  else if (mask) rec.maskText = mask;
  const sample = d['recordSample']?.trim();
  if (sample) {
    const n = Number(sample);
    if (Number.isFinite(n)) rec.sampleRate = Math.min(1, Math.max(0, n));
  }
  const canvas = d['recordCanvas'];
  if (canvas !== undefined && canvas !== 'false') {
    const n = Number(canvas);
    if (canvas === '' || canvas === 'true') rec.canvas = true;
    else if (Number.isFinite(n) && n > 0) rec.canvas = n;
  }
  if (d['recordingsSrc']) rec.src = d['recordingsSrc'];
  if (d['recordingsIntegrity']) rec.integrity = d['recordingsIntegrity'];
  return Object.keys(rec).length ? rec : true;
}

/** Settings from a script tag's data-* attributes. */
export function readScriptConfig(el: HTMLScriptElement): RecapConfig {
  const d = el.dataset;
  const config: RecapConfig = {};

  if (d['sessionName']) config.sessionName = d['sessionName'];
  if (d['showPanel'] === 'true') config.showPanel = true;
  if (d['panel'] === 'false') config.panel = false;
  else if (d['panel'] === 'true') config.panel = true;
  if (d['endpoint']) config.endpoint = d['endpoint'];
  if (d['supabaseUrl'] && d['supabaseKey']) {
    config.supabase = { url: d['supabaseUrl'], anonKey: d['supabaseKey'] };
  }
  if (d['appId']) config.appId = d['appId'];
  if (d['appVersion']) config.appVersion = d['appVersion'];
  // Page recordings: tabs sampled in load rrweb's recorder from next to this script.
  if (d['recordings'] === 'true') config.recordings = recordingsFrom(d);
  if (d['labels'] === 'none' || d['labels'] === 'attributes' || d['labels'] === 'text') config.labels = d['labels'];
  if (d['requireConsent'] === 'true') config.requireConsent = true;
  if (d['debug'] === 'true') config.debug = true;
  if (d['shortcut']) config.shortcut = d['shortcut'] === 'false' ? false : d['shortcut'];
  if (d['stripQueryParams'] === 'false') config.stripQueryParams = false;
  if (d['touchTrigger'] === 'false') config.touchTrigger = false;
  if (d['touchTriggerFingers']) config.touchTriggerFingers = parseInt(d['touchTriggerFingers'], 10);
  if (d['touchTriggerHoldMs']) config.touchTriggerHoldMs = parseInt(d['touchTriggerHoldMs'], 10);
  // The live-site gate.
  const hosts = list(d['hosts']);
  if (hosts) config.hosts = hosts;
  const excludePaths = list(d['excludePaths']);
  if (excludePaths?.length) config.excludePaths = excludePaths;
  if (d['respectGpc'] === 'false') config.respectGPC = false;
  else if (d['respectGpc'] === 'true') config.respectGPC = true;
  const frames = flag(d['allowInFrames']);
  if (frames !== undefined) config.allowInFrames = frames;

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
  // Captured now: document.currentScript is only set while this script first runs.
  setDefaultRrwebSrc(rrwebNextTo(script));
  if (script?.dataset['autoInit'] === 'false') return;
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', () => Recap.init(), { once: true });
  } else {
    Recap.init();
  }
}
