// Recap remote mode: sends the web tracker's events to your own Supabase project (or any endpoint),
// in the same format as the React Native SDK, so web sessions sit next to iOS and Android ones in the
// Recap dashboard. Optional page recordings for replay use rrweb, which you pass in.
//
// Without `remote` in the config none of this runs and Recap keeps everything in the browser.

import type { AnyEvent } from '../types.js';
import { getSessionId } from '../capture/session.js';

export const REMOTE_SDK_VERSION = 'web-0.1.0';

/** rrweb's `record` function. Pass `import { record } from 'rrweb'`, or load rrweb with a script tag. */
export type RrwebRecord = (options: {
  emit: (event: RrwebEvent) => void;
  [key: string]: unknown;
}) => (() => void) | undefined;

export interface RrwebEvent {
  type: number;
  timestamp: number;
  [key: string]: unknown;
}

export interface RemoteRecordingOptions {
  /** rrweb's record function. Defaults to `window.rrweb.record` when rrweb is on the page. */
  record?: RrwebRecord;
  /** Share of sessions to record, 0 to 1. Default 1. */
  sampleRate?: number;
  /** Extra CSS selector for parts of the page never recorded. `[data-ut-no-track]` and `.recap-private` always are. */
  blockSelector?: string;
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
  /** Log what Recap is doing to the console. */
  debug?: boolean;
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
const MILESTONES = [25, 50, 75, 100];
const MAX_BATCH = 200;
/** sendBeacon / keepalive bodies are capped at 64 KB by browsers. */
const KEEPALIVE_LIMIT = 60_000;
/** Recording chunks are sent at about this size. */
const DOM_CHUNK_BYTES = 400_000;

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
  // Recording
  private domBuffer: { t: number; e: RrwebEvent }[] = [];
  private domBytes = 0;
  private domSending = false;
  private stopRecording: (() => void) | null = null;

  constructor(config: RemoteConfig, fetchFn: FetchFn = (...a) => fetch(...a)) {
    if (!config.appId) throw new Error('Recap: remote.appId is required');
    if (!config.supabase && !config.endpoint) throw new Error('Recap: remote needs supabase or endpoint');
    this.config = config;
    this.fetchFn = fetchFn;
    this.sessionId = getSessionId();

    // One session can span several page loads in the same tab, so its start time lives in sessionStorage.
    const savedStart = Number(store('session', KEY_START));
    this.startMs = savedStart > 0 ? savedStart : Date.now();
    if (!(savedStart > 0)) store('session', KEY_START, String(this.startMs));
    this.uploaded = store('session', KEY_UPLOADED) === this.sessionId;

    const savedSample = store('session', KEY_SAMPLED);
    this.sampled = savedSample !== null ? savedSample === '1' : Math.random() < (config.sampleRate ?? 1);
    store('session', KEY_SAMPLED, this.sampled ? '1' : '0');
  }

  /** Start sending. Returns false if this session wasn't sampled. */
  start(): boolean {
    if (!this.sampled) return false;
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
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopRecording?.();
    this.stopRecording = null;
    this.stopFns.forEach((f) => f());
    this.stopFns = [];
    void this.flush();
  }

  getSessionId(): string {
    return this.sessionId;
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

  /** A custom event, e.g. track('added_to_basket', { sku: 'A1' }). */
  track(name: string, props: Record<string, unknown> = {}): void {
    if (!this.sampled || !name) return;
    this.push('custom', { name, ...props });
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

  private async post(kind: 'ingest' | 'dom', body: object, keepalive = false): Promise<void> {
    const target = this.target(kind);
    if (!target) return;
    const payload = this.config.supabase ? { payload: body } : body;
    const res = await this.fetchFn(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...target.headers },
      body: JSON.stringify(payload),
      keepalive,
    });
    if (!res.ok) throw Object.assign(new Error(`Recap: upload failed with HTTP ${res.status}`), { status: res.status });
  }

  /** Send queued events (and recording chunks). Calls run one after another, never overlapping. */
  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.sendQueued()).catch(() => undefined);
    return this.chain;
  }

  private async sendQueued(): Promise<void> {
    while (this.queue.length) {
      const events = this.queue.slice(0, MAX_BATCH);
      try {
        await this.post('ingest', this.batch(events));
      } catch (err) {
        this.log('upload failed; will retry', err);
        return;
      }
      this.queue.splice(0, events.length);
      if (!this.uploaded) {
        this.uploaded = true;
        store('session', KEY_UPLOADED, this.sessionId);
      }
      this.log(`uploaded ${events.length} events`);
    }
    await this.sendDom();
  }

  /** The page is going away: send what fits in a keepalive request. */
  private flushOnExit(): void {
    if (this.queue.length) {
      const events = this.queue.slice(0, MAX_BATCH);
      const body = this.batch(events);
      if (JSON.stringify(body).length < KEEPALIVE_LIMIT) {
        this.queue.splice(0, events.length);
        void this.post('ingest', body, true).catch(() => undefined);
        this.uploaded = true;
        store('session', KEY_UPLOADED, this.sessionId);
      }
    }
    if (this.uploaded && this.domBuffer.length) {
      const chunk = this.takeDomChunk(KEEPALIVE_LIMIT);
      if (chunk.length) void this.post('dom', this.domPayload(chunk), true).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------- recordings

  private startRecording(): void {
    const opt = this.config.recordings;
    if (!opt) return;
    const o: RemoteRecordingOptions = opt === true ? {} : opt;
    const key = 'recap-remote-rec';
    const saved = store('session', key);
    const on = saved !== null ? saved === '1' : Math.random() < (o.sampleRate ?? 1);
    store('session', key, on ? '1' : '0');
    if (!on) return;
    const record =
      o.record ?? (globalThis as unknown as { rrweb?: { record?: RrwebRecord } }).rrweb?.record;
    if (!record) {
      this.log('recordings are on but rrweb was not found: pass recordings.record, or load rrweb first');
      return;
    }
    const block = ['[data-ut-no-track]', '.ut-block', '.recap-private', o.blockSelector].filter(Boolean).join(', ');
    const stop = record({
      emit: (e: RrwebEvent) => this.pushDom(e),
      maskAllInputs: true,
      blockSelector: block,
      inlineStylesheet: true,
      recordCanvas: false,
      collectFonts: false,
      sampling: { mousemove: 50, scroll: 100, input: 'last', media: 800 },
      slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true, headMetaSocial: true },
    });
    this.stopRecording = stop ?? null;
    this.log('recording the page for replay');
  }

  private pushDom(e: RrwebEvent): void {
    const t = Math.max(0, e.timestamp - this.startMs);
    this.domBuffer.push({ t, e });
    this.domBytes += JSON.stringify(e).length;
    if (this.domBytes >= DOM_CHUNK_BYTES && this.uploaded) void this.sendDom();
  }

  private takeDomChunk(maxBytes: number): { t: number; e: RrwebEvent }[] {
    const out: { t: number; e: RrwebEvent }[] = [];
    let size = 0;
    while (this.domBuffer.length) {
      const next = this.domBuffer[0]!;
      const n = JSON.stringify(next.e).length;
      // Always take at least one event, so a big full snapshot still goes on its own.
      if (out.length && size + n > maxBytes) break;
      out.push(next);
      size += n;
      this.domBuffer.shift();
      this.domBytes -= n;
    }
    return out;
  }

  private domPayload(chunk: { t: number; e: RrwebEvent }[]): object {
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
          if ((err as { status?: number }).status === 404) {
            // The database doesn't have the web recordings migration yet: stop recording this session.
            this.log('recordings are off: run supabase/migrations/*_recap_dom.sql in your Supabase project');
            this.stopRecording?.();
            this.stopRecording = null;
            this.domBuffer = [];
            this.domBytes = 0;
            break;
          }
          // Put it back and try again on the next flush.
          this.domBuffer.unshift(...chunk);
          this.domBytes += chunk.reduce((n, c) => n + JSON.stringify(c.e).length, 0);
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
