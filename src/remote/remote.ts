// Recap remote mode: sends the web tracker's events to your own Supabase project (or any endpoint),
// in the same format as the React Native SDK, so web sessions sit next to iOS and Android ones in the
// Recap dashboard. Optional page recordings for replay use rrweb: passed in, already on the page, or
// loaded on demand from recap-rrweb.min.js for tabs sampled in.
//
// Without `remote` in the config none of this runs and Recap keeps everything in the browser.

import type { AnyEvent } from '../types.js';
import { getSessionId } from '../capture/session.js';
import { EXCLUDE_SELECTOR, MASK_SELECTOR } from '../privacy/sanitize.js';
import { secretKeyKind, secretKeyMessage } from '../gate.js';
import { DomCleaner } from './clean-dom.js';

export const REMOTE_SDK_VERSION = 'web-0.3.1';

/**
 * Places people type that aren't form fields: contenteditable regions (chat boxes, rich-text
 * editors) and custom text boxes. Their text is always masked in recordings, like form fields.
 */
export const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"]), [role="textbox"]';

/**
 * rrweb's maskInputOptions: every kind of field whose value is text, including hidden fields (CSRF
 * tokens) and file pickers (the file name). The same list as rrweb's maskAllInputs, plus hidden
 * and file. Checkboxes and radio buttons keep their ticked state.
 */
export const MASK_INPUT_OPTIONS: Readonly<Record<string, true>> = {
  color: true,
  date: true,
  'datetime-local': true,
  email: true,
  month: true,
  number: true,
  range: true,
  search: true,
  tel: true,
  text: true,
  time: true,
  url: true,
  week: true,
  textarea: true,
  select: true,
  password: true,
  hidden: true,
  file: true,
};

/**
 * The rrweb maskTextSelector for a recordings.maskText setting. The mask marker and editable
 * regions are always masked.
 */
export function maskTextSelectorFor(maskText: boolean | string | undefined): string {
  if (maskText === true) return '*';
  const extra = typeof maskText === 'string' ? maskText.trim() : '';
  return [MASK_SELECTOR, EDITABLE_SELECTOR, extra].filter(Boolean).join(', ');
}

/** Whether the browser accepts `selector` as a CSS selector list. */
export function isValidSelector(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/** Canvas frames per second for a recordings.canvas setting: 2 for true, the number given, or 0 (off). */
export function canvasFps(canvas: boolean | number | undefined): number {
  if (canvas === true) return 2;
  return typeof canvas === 'number' && Number.isFinite(canvas) && canvas > 0 ? canvas : 0;
}

// ---------------------------------------------------------------- loading rrweb on demand

let _defaultRrwebSrc: string | null = null;
let _defaultRrwebIntegrity: string | null = null;

/**
 * Where to load recap-rrweb.min.js from when recordings.src isn't set, and its subresource
 * integrity hash. The script-tag build sets them to the folder recap.min.js was loaded from and the
 * hash of the recap-rrweb.min.js built with it.
 * @internal
 */
export function setDefaultRrwebSrc(src: string | null, integrity: string | null = null): void {
  _defaultRrwebSrc = src;
  _defaultRrwebIntegrity = integrity || null;
}

const _loads = new Map<string, Promise<void>>();

/**
 * Add a <script> for `src` once per address, resolving when it has run. Rejects (never throws) if
 * it can't load: offline, blocked by a Content-Security-Policy, the wrong address or the wrong
 * integrity hash. A failed address can be tried again by a later call.
 */
export function loadScript(src: string, integrity?: string): Promise<void> {
  const known = _loads.get(src);
  if (known) return known;
  const p = new Promise<void>((resolve, reject) => {
    try {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      if (integrity) {
        s.integrity = integrity;
        s.crossOrigin = 'anonymous'; // subresource integrity needs a CORS request
      }
      s.onload = () => resolve();
      s.onerror = () => {
        s.remove();
        reject(new Error(`could not load ${src}`));
      };
      (document.head ?? document.documentElement).appendChild(s);
    } catch (err) {
      reject(err);
    }
  });
  _loads.set(src, p);
  p.catch(() => _loads.delete(src));
  return p;
}

/** window.rrweb.record: rrweb loaded by the page itself (or by an older recap-rrweb.min.js). */
function pageRecord(): RrwebRecord | undefined {
  return (globalThis as unknown as { rrweb?: { record?: RrwebRecord } }).rrweb?.record;
}

/** The recorder recap-rrweb.min.js sets up: window.RecapRrweb.record. */
function ownRecord(): RrwebRecord | undefined {
  return (globalThis as unknown as { RecapRrweb?: { record?: RrwebRecord } }).RecapRrweb?.record;
}

/** rrweb's `record` function. Pass `import { record } from 'rrweb'`, or load rrweb with a script tag. */
export type RrwebRecord = ((options: {
  emit: (event: RrwebEvent) => void;
  [key: string]: unknown;
}) => (() => void) | undefined) & {
  /** rrweb's record.takeFullSnapshot, used to start again after dropping a backlog. */
  takeFullSnapshot?: (isCheckout?: boolean) => void;
};

export interface RrwebEvent {
  type: number;
  timestamp: number;
  [key: string]: unknown;
}

export interface RemoteRecordingOptions {
  /**
   * rrweb's record function (`import { record } from 'rrweb'`, version 2.2.2). Without it Recap
   * loads recap-rrweb.min.js from `src` (or uses `window.rrweb.record` with `useGlobalRrweb`).
   */
  record?: RrwebRecord;
  /**
   * Use `window.rrweb.record` when the page already has rrweb, instead of loading Recap's own
   * recorder. Only for an rrweb 2.2.2 you load yourself: another version may not mask the same way.
   * Default false: rrweb already on the page is ignored.
   */
  useGlobalRrweb?: boolean;
  /**
   * Address of recap-rrweb.min.js (rrweb's recorder as a plain script), loaded only for tabs sampled
   * in for recordings and only when `record` isn't given. The script-tag build defaults to the folder
   * recap.min.js came from; module builds need this or `record`. Script tag: data-recordings-src.
   */
  src?: string;
  /**
   * Subresource integrity hash for `src`, e.g. "sha384-…". The script-tag build checks its own
   * recap-rrweb.min.js (the one next to recap.min.js) against the hash it was built with; this
   * replaces that. Script tag: data-recordings-integrity.
   */
  integrity?: string;
  /** Share of tabs to record, 0 to 1. Default 1. Script tag: data-record-sample. */
  sampleRate?: number;
  /**
   * Record <canvas> drawings (charts, for example) as pictures: `true` for 2 frames a second, or a
   * number of frames a second. Unchanged frames aren't sent again. Default off. Script tag:
   * data-record-canvas.
   */
  canvas?: boolean | number;
  /**
   * Extra CSS selector for parts of the page never recorded. The privacy marker (`data-recap-private`,
   * `.recap-private`) always is. If it isn't a valid selector, nothing is recorded (an error says why).
   */
  blockSelector?: string;
  /**
   * Text to replace with `*` in recordings, keeping the layout: `true` for all text on the page, or
   * a CSS selector for the parts to mask (and everything inside them). Text inside the mask marker
   * (`data-recap-mask`, `.recap-mask`) is always masked, and so is text in contenteditable regions
   * and `role="textbox"`. Form fields are always masked, whatever this says. Default: only those.
   * If the selector isn't valid, nothing is recorded (an error says why).
   */
  maskText?: boolean | string;
}

export interface RemoteConfig {
  /** A short name for this site or app, e.g. "my-shop-web". */
  appId: string;
  /** Send to the Recap tables in your own Supabase project. */
  supabase?: { url: string; anonKey: string };
  /** Or POST batches to any endpoint you run (same body as the mobile SDK's endpoint transport). */
  endpoint?: { url: string; headers?: Record<string, string>; recordingsUrl?: string };
  /** Your site's version, shown in the dashboard. */
  appVersion?: string;
  /** How often queued events are sent. Default 5000 ms. */
  flushIntervalMs?: number;
  /** Share of sessions to send, 0 to 1. Default 1. */
  sampleRate?: number;
  /** Page recordings for session replay. Typing is always masked. Off by default. */
  recordings?: boolean | RemoteRecordingOptions;
  /**
   * Remove the query string from the page address sent with recordings (the hash is always
   * removed). Default true; the web tracker passes on its own `stripQueryParams`.
   */
  stripQueryParams?: boolean;
  /** Log what Recap is doing to the console. */
  debug?: boolean;
}

/** How the web tracker starts a sink in a tab with a test switch (?recap=on or ?recap=record). */
export interface SinkOptions {
  /** Send this session whatever `sampleRate` says. */
  sampleIn?: boolean;
  /** Record this tab's page whatever `recordings.sampleRate` says. */
  recordIn?: boolean;
}

interface IngestEvent {
  type: 'screen' | 'tap' | 'scroll' | 'app_state' | 'custom';
  t: number;
  at: string;
  screen: string | null;
  data: Record<string, unknown>;
}

type FetchFn = typeof fetch;

const KEY_START = 'recap-remote-start';
const KEY_UPLOADED = 'recap-remote-uploaded';
const KEY_SAMPLED = 'recap-remote-sampled';
const KEY_ANON = 'recap-remote-anon';
const KEY_REC = 'recap-remote-rec';
/** Custom event properties above this, as JSON, are not sent. */
const MAX_PROPS_BYTES = 8 * 1024;
const MILESTONES = [25, 50, 75, 100];
const MAX_BATCH = 200;
/**
 * Browsers allow about 64 KB of keepalive requests in flight per page, all together. Requests that
 * fit go as keepalive, so they still arrive if the page closes while they're on the way.
 */
const KEEPALIVE_LIMIT = 60_000;
/** Recording chunks are sent at about this size. */
const DOM_CHUNK_BYTES = 400_000;
/** recap_dom takes at most 5000 events and about 3 MB per chunk. */
const DOM_CHUNK_EVENTS = 2000;
const DOM_EVENT_MAX_BYTES = 2_500_000;
/** Debug mode warns about full snapshots above this, as they near DOM_EVENT_MAX_BYTES. */
const DOM_SNAPSHOT_WARN_BYTES = 2_000_000;
/** Most recording kept in memory while it can't be sent (offline, or the session not stored yet). */
const DOM_BUFFER_MAX_BYTES = 5_000_000;

/** UTF-8 size of a string, without allocating. Server limits are in bytes, not JS string length. */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Errors worth retrying: no response at all, timeouts, rate limits and server errors. */
function retryable(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

interface DomItem {
  t: number;
  e: RrwebEvent;
  /** UTF-8 bytes of the event as JSON. */
  n: number;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function store(kind: 'session' | 'local', key: string, value?: string): string | null {
  try {
    const s = kind === 'session' ? sessionStorage : localStorage;
    if (value !== undefined) s.setItem(key, value);
    return s.getItem(key);
  } catch {
    return value ?? null;
  }
}

function browserInfo(): { model: string | null; os: string | null } {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const model = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return { model, os };
}

/**
 * Forget this tab's dashboard session and the browser's random id (the visitor opted out), so a
 * later opt-in starts a new session, sampled afresh, that can't be linked to this one.
 */
export function forgetRemoteSession(): void {
  for (const key of [KEY_START, KEY_UPLOADED, KEY_SAMPLED, KEY_REC]) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // storage blocked: nothing was kept
    }
  }
  try {
    localStorage.removeItem(KEY_ANON);
  } catch {
    // storage blocked: nothing was kept
  }
}

interface RecordingSelectors {
  block: string;
  mask: string;
}

/**
 * rrweb's blockSelector and maskTextSelector for these options, or null (with an error in the
 * console, debug or not) if the site's own selectors aren't valid CSS: rrweb would ignore the whole
 * list, privacy markers included, so the page isn't recorded at all.
 */
function recordingSelectors(o: RemoteRecordingOptions): RecordingSelectors | null {
  const own: Array<[string, unknown]> = [
    ['recordings.blockSelector', o.blockSelector],
    ['recordings.maskText (data-mask-text)', typeof o.maskText === 'string' ? o.maskText : undefined],
  ];
  for (const [option, value] of own) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || (value.trim() && !isValidSelector(value))) {
      console.error(`[Recap] recordings are off for this page: ${option} is not a valid CSS selector: ${String(value)}`);
      return null;
    }
  }
  const block = [EXCLUDE_SELECTOR, o.blockSelector?.trim()].filter(Boolean).join(', ');
  const mask = maskTextSelectorFor(o.maskText);
  if (!isValidSelector(block) || !isValidSelector(mask)) {
    console.error('[Recap] recordings are off for this page: this browser does not accept the privacy selectors');
    return null;
  }
  return { block, mask };
}

export class RemoteSink {
  private readonly config: RemoteConfig;
  private readonly fetchFn: FetchFn;
  private readonly sessionId: string;
  private readonly startMs: number;
  private readonly sampled: boolean;
  private queue: IngestEvent[] = [];
  private screen: string | null = null;
  private scrollMax = new Map<string, number>();
  private uploaded: boolean;
  private chain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopFns: Array<() => void> = [];
  /** Bytes of keepalive requests still on the way. */
  private keepaliveBytes = 0;
  // Recording
  private domBuffer: DomItem[] = [];
  private domBytes = 0;
  private domSending = false;
  private stopRecording: (() => void) | null = null;
  private recordFn: RrwebRecord | null = null;
  /** Started and not stopped: a recorder that finishes loading after stop() must not start. */
  private active = false;
  /** Recording is off for the rest of this page load (it went to a path in excludePaths). */
  private recordingBlocked = false;
  private readonly opts: SinkOptions;
  private readonly cleaner: DomCleaner;

  constructor(config: RemoteConfig, fetchFn: FetchFn = (...a) => fetch(...a), opts: SinkOptions = {}) {
    if (!config.appId) throw new Error('Recap: remote.appId is required');
    if (!config.supabase && !config.endpoint) throw new Error('Recap: remote needs supabase or endpoint');
    this.config = config;
    this.fetchFn = fetchFn;
    this.opts = opts;
    this.cleaner = new DomCleaner(config.stripQueryParams === false);
    this.sessionId = getSessionId();

    // One session can span several page loads in the same tab, so its start time lives in sessionStorage.
    const savedStart = Number(store('session', KEY_START));
    this.startMs = savedStart > 0 ? savedStart : Date.now();
    if (!(savedStart > 0)) store('session', KEY_START, String(this.startMs));
    this.uploaded = store('session', KEY_UPLOADED) === this.sessionId;

    const savedSample = store('session', KEY_SAMPLED);
    this.sampled =
      opts.sampleIn === true || (savedSample !== null ? savedSample === '1' : Math.random() < (config.sampleRate ?? 1));
    store('session', KEY_SAMPLED, this.sampled ? '1' : '0');
  }

  /** Start sending. Returns false if this session wasn't sampled, or the key is a secret one. */
  start(): boolean {
    const secret = secretKeyKind(this.config.supabase?.anonKey);
    if (secret) {
      console.error(secretKeyMessage(secret));
      return false;
    }
    if (!this.sampled) return false;
    this.active = true;
    this.timer = setInterval(() => void this.flush(), this.config.flushIntervalMs ?? 5000);
    const onVis = (): void => {
      const hidden = document.visibilityState === 'hidden';
      this.push('app_state', { state: hidden ? 'background' : 'active' });
      if (hidden) this.flushOnExit();
    };
    const onHide = (): void => this.flushOnExit();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    this.stopFns.push(
      () => document.removeEventListener('visibilitychange', onVis),
      () => window.removeEventListener('pagehide', onHide),
    );
    this.startRecording();
    this.log(`session ${this.sessionId} sending to the dashboard`);
    return true;
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopRecording?.();
    this.stopRecording = null;
    this.stopFns.forEach((f) => f());
    this.stopFns = [];
    void this.flush();
  }

  /**
   * The visitor opted out: stop at once and delete everything not yet sent (events and
   * recording). This tab's session and the browser's random id are forgotten too, so a later
   * opt-in starts a new session that can't be linked to earlier visits.
   */
  discard(): void {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopFns.forEach((f) => f());
    this.stopFns = [];
    this.endRecording('opted out: recording stopped');
    this.queue = [];
    forgetRemoteSession();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /** Whether this tab's page is being recorded now. */
  isRecordingPage(): boolean {
    return this.recordFn !== null && !this.recordingBlocked;
  }

  /**
   * Stop recording the page for the rest of this page load, and don't start (or finish loading) a
   * recorder. What was recorded before is still sent. Used when a single-page app goes to a path
   * in excludePaths: the private page can stay on screen for a moment after the address changes,
   * so a fresh snapshot taken when it leaves could still show it.
   */
  blockRecording(reason: string): void {
    if (this.recordingBlocked) return;
    this.recordingBlocked = true;
    if (this.recordFn) this.log(reason);
    this.stopRecording?.();
    this.stopRecording = null;
  }

  /** Feed one event from the web tracker's capture layers. */
  handle(event: AnyEvent): void {
    if (!this.sampled) return;
    switch (event.type) {
      case 'navigation': {
        if (event.to === this.screen) return;
        const from = this.screen;
        this.screen = event.to;
        this.push('screen', { from, method: event.method });
        return;
      }
      case 'click': {
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        this.push('tap', {
          x: Math.round(event.clientX),
          y: Math.round(event.clientY),
          nx: Math.min(1, Math.max(0, event.clientX / w)),
          ny: Math.min(1, Math.max(0, event.clientY / h)),
          label: event.label,
          selector: event.selector,
          tag: event.tagName,
          pageY: Math.round(event.pageY),
        });
        return;
      }
      case 'scroll': {
        const key = this.screen ?? '';
        const prev = this.scrollMax.get(key) ?? 0;
        const d = Math.max(0, Math.min(100, Math.round(event.depth)));
        if (d <= prev) return;
        this.scrollMax.set(key, d);
        const crossed = MILESTONES.filter((m) => prev < m && d >= m);
        if (crossed.length) this.push('scroll', { depth: crossed[crossed.length - 1], maxDepth: d });
        return;
      }
      default:
        return;
    }
  }

  /**
   * A custom event, e.g. track('added_to_basket', { sku: 'A1' }). The properties are copied as JSON
   * now: ones that can't be (circular, BigInt) or come to more than 8 KB drop the event, so one bad
   * call can't hold up the rest of the session. A `name` property can't replace the event's name.
   */
  track(name: string, props: Record<string, unknown> = {}): void {
    if (!this.sampled || typeof name !== 'string' || !name) return;
    let json: string | undefined;
    try {
      json = JSON.stringify(props ?? {});
    } catch (err) {
      this.log(`track('${name}') dropped: its properties can't be sent as JSON (circular, or a BigInt)`, err);
      return;
    }
    const bytes = json === undefined ? 0 : utf8Bytes(json);
    if (bytes > MAX_PROPS_BYTES) {
      this.log(`track('${name}') dropped: its properties are ${Math.ceil(bytes / 1024)} KB as JSON, over the 8 KB limit`);
      return;
    }
    const copy: unknown = json === undefined ? null : JSON.parse(json);
    const data = copy && typeof copy === 'object' && !Array.isArray(copy) ? (copy as Record<string, unknown>) : {};
    if ('name' in data) this.log(`track('${name}'): its name property was left out; it can't replace the event name`);
    this.push('custom', { ...data, name });
  }

  pending(): readonly IngestEvent[] {
    return this.queue;
  }

  private push(type: IngestEvent['type'], data: Record<string, unknown>): void {
    const now = Date.now();
    this.queue.push({ type, t: Math.max(0, now - this.startMs), at: new Date(now).toISOString(), screen: this.screen, data });
    if (this.queue.length > 1000) this.queue.splice(0, this.queue.length - 1000);
    if (type === 'screen' && !this.uploaded) void this.flush();
  }

  private batch(events: IngestEvent[]): object {
    const { model, os } = browserInfo();
    let anon = store('local', KEY_ANON);
    if (!anon) anon = store('local', KEY_ANON, uuid());
    return {
      appId: this.config.appId,
      sdkVersion: REMOTE_SDK_VERSION,
      session: {
        id: this.sessionId,
        startedAt: new Date(this.startMs).toISOString(),
        userId: null,
        anonymousId: anon,
        device: {
          platform: 'web',
          osVersion: os,
          model,
          appVersion: this.config.appVersion ?? null,
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
          locale: typeof navigator !== 'undefined' ? navigator.language : null,
        },
      },
      events,
    };
  }

  private target(kind: 'ingest' | 'dom'): { url: string; headers: Record<string, string> } | null {
    const { supabase, endpoint } = this.config;
    if (supabase) {
      const base = supabase.url.replace(/\/+$/, '');
      const key = supabase.anonKey;
      const headers: Record<string, string> = key.startsWith('eyJ')
        ? { apikey: key, Authorization: `Bearer ${key}` }
        : { apikey: key };
      return { url: `${base}/rest/v1/rpc/${kind === 'ingest' ? 'recap_ingest' : 'recap_dom'}`, headers };
    }
    if (endpoint) {
      const url = kind === 'ingest' ? endpoint.url : endpoint.recordingsUrl;
      return url ? { url, headers: endpoint.headers ?? {} } : null;
    }
    return null;
  }

  /**
   * POST one batch. It goes as keepalive when it fits in what's left of the browser's keepalive
   * allowance. With `exitOnly` it is only sent as keepalive (the page is closing), and refused otherwise.
   */
  private async post(kind: 'ingest' | 'dom', body: object, exitOnly = false): Promise<void> {
    const target = this.target(kind);
    if (!target) return;
    const json = JSON.stringify(this.config.supabase ? { payload: body } : body);
    const size = utf8Bytes(json);
    const keepalive = this.keepaliveBytes + size <= KEEPALIVE_LIMIT;
    if (exitOnly && !keepalive) throw new Error('Recap: too large to send while the page closes');
    if (keepalive) this.keepaliveBytes += size;
    try {
      const res = await this.fetchFn(target.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...target.headers },
        body: json,
        keepalive,
      });
      if (!res.ok) throw Object.assign(new Error(`Recap: upload failed with HTTP ${res.status}`), { status: res.status });
    } finally {
      if (keepalive) this.keepaliveBytes -= size;
    }
  }

  /** Send queued events (and recording chunks). Calls run one after another, never overlapping. */
  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.sendQueued()).catch(() => undefined);
    return this.chain;
  }

  private markUploaded(): void {
    if (this.uploaded) return;
    this.uploaded = true;
    store('session', KEY_UPLOADED, this.sessionId);
  }

  private async sendQueued(): Promise<void> {
    while (this.queue.length) {
      // Take the batch out of the queue while it's on the way, so an exit flush can't send it again.
      const events = this.queue.splice(0, MAX_BATCH);
      try {
        await this.post('ingest', this.batch(events));
      } catch (err) {
        this.queue.unshift(...events);
        this.log('upload failed; will retry', err);
        return;
      }
      this.markUploaded();
      this.log(`uploaded ${events.length} events`);
    }
    await this.sendDom();
  }

  /**
   * The page is hidden or closing: send what fits in keepalive requests. A batch already on the way
   * is left to finish (it went as keepalive if it fitted). Recording chunks only follow once the
   * session is stored, because recap_dom drops chunks for sessions it doesn't know yet.
   */
  private flushOnExit(): void {
    if (!this.queue.length) {
      this.sendDomOnExit();
      return;
    }
    const events = this.queue.splice(0, MAX_BATCH);
    this.post('ingest', this.batch(events), true).then(
      () => {
        this.markUploaded();
        this.sendDomOnExit();
      },
      () => {
        // Too big for keepalive, or it failed: keep the events for the next flush.
        this.queue.unshift(...events);
      },
    );
  }

  private sendDomOnExit(): void {
    if (!this.uploaded || !this.domBuffer.length) return;
    // Leave room for the request's own wrapper. A chunk that doesn't fit (a full page snapshot,
    // usually) stays in the buffer for the next normal upload rather than being lost.
    const room = KEEPALIVE_LIMIT - this.keepaliveBytes - 1_000;
    if (room <= 0 || this.domBuffer[0]!.n > room) return;
    const chunk = this.takeDomChunk(room);
    this.post('dom', this.domPayload(chunk), true).catch(() => this.putBackDom(chunk));
  }

  // ---------------------------------------------------------------- recordings

  private startRecording(): void {
    try {
      const opt = this.config.recordings;
      if (!opt || this.recordingBlocked) return;
      const o: RemoteRecordingOptions = opt === true ? {} : opt;
      // Checked before anything loads: rrweb ignores a selector it can't read, which would record
      // the parts the privacy markers are meant to keep out.
      const selectors = recordingSelectors(o);
      if (!selectors) return;
      const saved = store('session', KEY_REC);
      const on = this.opts.recordIn === true || (saved !== null ? saved === '1' : Math.random() < (o.sampleRate ?? 1));
      store('session', KEY_REC, on ? '1' : '0');
      if (!on) {
        // Tabs left out never load the recorder.
        this.log('recordings: this tab is not in the recorded share (recordings.sampleRate)');
        return;
      }
      // rrweb already on the page is used only when the site asks: it may be another version.
      const record = o.record ?? (o.useGlobalRrweb === true ? pageRecord() : undefined);
      if (record) {
        this.beginRecording(record, o, selectors);
        return;
      }
      const src = o.src ?? _defaultRrwebSrc;
      if (!src) {
        this.log(
          "recordings are on but rrweb isn't loaded: pass recordings.record (import { record } from 'rrweb'), " +
            'recordings.src with the address of recap-rrweb.min.js, or useGlobalRrweb: true to use rrweb already on the page',
        );
        return;
      }
      // Recap's own recorder, next to recap.min.js, is checked against the hash it was built with.
      const integrity = o.integrity ?? (o.src ? undefined : (_defaultRrwebIntegrity ?? undefined));
      this.log(`loading the recorder from ${src}${integrity ? ' (integrity checked)' : ''}`);
      loadScript(src, integrity).then(
        () => {
          if (!this.active || this.recordingBlocked || this.recordFn) return;
          const loaded = ownRecord() ?? pageRecord();
          if (loaded) this.beginRecording(loaded, o, selectors);
          else this.log(`recordings are off for this page: ${src} loaded but did not set window.rrweb.record`);
        },
        (err: unknown) =>
          this.log(
            `recordings are off for this page: could not load ${src} (blocked by a Content-Security-Policy, offline, or the wrong address)`,
            err,
          ),
      );
    } catch (err) {
      this.log('recordings are off for this page: could not start the recorder', err);
    }
  }

  private beginRecording(record: RrwebRecord, o: RemoteRecordingOptions, selectors: RecordingSelectors): void {
    const fps = canvasFps(o.canvas);
    // Set before record() runs: rrweb emits the first full snapshot while it starts.
    this.recordFn = record;
    let stop: (() => void) | undefined;
    try {
      stop = record({
        emit: (e: RrwebEvent) => this.pushDom(e),
        // Every field whose value is text, hidden fields included (not maskAllInputs, which skips them).
        maskInputOptions: { ...MASK_INPUT_OPTIONS },
        blockSelector: selectors.block,
        // Text is replaced with * (same length, so the layout stays): the mask marker and editable
        // regions always, plus maskText.
        maskTextSelector: selectors.mask,
        inlineStylesheet: true,
        recordCanvas: fps > 0,
        collectFonts: false,
        sampling: { mousemove: 50, scroll: 100, input: 'last', media: 800, ...(fps > 0 ? { canvas: fps } : {}) },
        // Canvas frames as compressed pictures (a browser that can't make WebP sends PNG).
        ...(fps > 0 ? { dataURLOptions: { type: 'image/webp', quality: 0.6 } } : {}),
        slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true, headMetaSocial: true },
      });
    } catch (err) {
      this.recordFn = null;
      this.log('recordings are off for this page: rrweb could not start', err);
      return;
    }
    if (!this.recordFn) {
      stop?.(); // the first snapshot already ended recording (page too large)
      return;
    }
    this.stopRecording = stop ?? null;
    this.log(fps > 0 ? `recording the page for replay, canvas at ${fps} frames a second` : 'recording the page for replay');
  }

  /** Stop recording this session and drop what's buffered. */
  private endRecording(reason: string): void {
    this.log(reason);
    this.stopRecording?.();
    this.stopRecording = null;
    this.recordFn = null;
    this.domBuffer = [];
    this.domBytes = 0;
  }

  private pushDom(event: RrwebEvent): void {
    if (!this.recordFn || this.recordingBlocked) return;
    let e: RrwebEvent;
    try {
      e = this.cleaner.clean(event);
    } catch (err) {
      // Never send an event that couldn't be cleaned; the replay can't go on without it.
      this.endRecording('recordings are off for this session: an event could not be cleaned');
      this.log('clean error', err);
      return;
    }
    const n = utf8Bytes(JSON.stringify(e));
    if (e.type === 2) {
      this.log(`full snapshot: ${Math.round(n / 1000)} KB`);
      if (this.config.debug && n > DOM_SNAPSHOT_WARN_BYTES && n <= DOM_EVENT_MAX_BYTES) {
        console.warn(
          `[Recap] full snapshot is ${(n / 1e6).toFixed(1)} MB, close to the ${DOM_EVENT_MAX_BYTES / 1e6} MB limit: ` +
            'above it, recordings stop for the session. Mark large parts data-recap-private, or trim inline images and styles.',
        );
      }
    }
    if (n > DOM_EVENT_MAX_BYTES) {
      // recap_dom can't store a snapshot this big, and the replay is useless without it.
      this.endRecording(`recordings are off for this session: the page is too large to record (${Math.round(n / 1e6)} MB)`);
      return;
    }
    this.domBuffer.push({ t: Math.max(0, e.timestamp - this.startMs), e, n });
    this.domBytes += n;
    if (this.domBytes > DOM_BUFFER_MAX_BYTES) {
      // Can't send for now (offline, or the session isn't stored yet). Keep memory bounded: start
      // again from a fresh snapshot of the page, so the replay stays playable from here on.
      this.domBuffer = [];
      this.domBytes = 0;
      if (this.recordFn.takeFullSnapshot) {
        this.log('recording buffer full while offline; starting again from a fresh snapshot');
        this.recordFn.takeFullSnapshot(true);
      } else {
        this.endRecording('recordings are off for this session: too much recording waiting to be sent');
      }
      return;
    }
    if (this.domBytes >= DOM_CHUNK_BYTES && this.uploaded) void this.sendDom();
  }

  /** The oldest buffered events, up to maxBytes. Always at least one, so a big snapshot goes alone. */
  private takeDomChunk(maxBytes: number): DomItem[] {
    const out: DomItem[] = [];
    let size = 0;
    while (this.domBuffer.length && out.length < DOM_CHUNK_EVENTS) {
      const next = this.domBuffer[0]!;
      if (out.length && size + next.n > maxBytes) break;
      out.push(next);
      size += next.n;
      this.domBuffer.shift();
      this.domBytes -= next.n;
    }
    return out;
  }

  private putBackDom(chunk: DomItem[]): void {
    if (!this.recordFn) return; // recording ended meanwhile
    this.domBuffer.unshift(...chunk);
    this.domBytes += chunk.reduce((n, c) => n + c.n, 0);
  }

  private domPayload(chunk: DomItem[]): object {
    return { appId: this.config.appId, sessionId: this.sessionId, t: chunk[0]?.t ?? 0, events: chunk.map((c) => c.e) };
  }

  private async sendDom(): Promise<void> {
    if (this.domSending || !this.uploaded || this.domBuffer.length === 0) return;
    this.domSending = true;
    try {
      while (this.domBuffer.length) {
        const chunk = this.takeDomChunk(DOM_CHUNK_BYTES);
        try {
          await this.post('dom', this.domPayload(chunk));
          this.log(`uploaded ${chunk.length} recording events`);
        } catch (err) {
          const status = (err as { status?: number }).status;
          if (status === 404) {
            this.endRecording('recordings are off: run supabase/migrations/*_recap_dom.sql in your Supabase project');
            break;
          }
          if (!retryable(err)) {
            // The database refused this chunk (400 and similar). Sending it again won't help, and
            // the events after it can't be replayed without it.
            this.endRecording(`recordings are off for this session: the database refused a chunk (HTTP ${status})`);
            break;
          }
          // Put it back and try again on the next flush.
          this.putBackDom(chunk);
          this.log('recording upload failed; will retry', err);
          break;
        }
      }
    } finally {
      this.domSending = false;
    }
  }

  private log(msg: string, err?: unknown): void {
    if (!this.config.debug) return;
    if (err) console.warn(`[Recap] ${msg}`, err);
    else console.log(`[Recap] ${msg}`);
  }
}
