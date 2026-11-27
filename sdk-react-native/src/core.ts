// Recap core: session handling, consent, sampling, the offline queue and uploads.
// Pure TypeScript with no React Native imports, so it runs (and is tested) anywhere.

import { endpointTransport, supabaseTransport } from './transports';
import type {
  DeviceInfo,
  FramesPayload,
  IngestBatch,
  RecapConfig,
  RecapEvent,
  RecapEventType,
  RecordingOptions,
  ScreenCapture,
  SessionInfo,
  StorageAdapter,
  TapInput,
  Transport,
} from './types';

export const SDK_VERSION = '0.3.0';

const KEY_QUEUE = 'recap:queue';
const KEY_CONSENT = 'recap:consent';
const KEY_INSTALL = 'recap:install';
const KEY_SHOTS = 'recap:shots';

/** A label arriving this close to a tap (either side) is attached to that tap. */
const LABEL_WINDOW_MS = 600;
const SCROLL_MILESTONES = [25, 50, 75, 100];

type ConsentState = 'granted' | 'denied' | 'unknown';

interface QueuedEvent extends RecapEvent {
  sessionId: string;
}

export interface CoreDeps {
  now?: () => number;
  random?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

const DEFAULT_DEVICE: DeviceInfo = {
  platform: 'other',
  osVersion: null,
  model: null,
  appVersion: null,
  screenWidth: 0,
  screenHeight: 0,
  locale: null,
};

export function uuid(random: () => number = Math.random): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class RecapCore {
  private config: RecapConfig | null = null;
  private transport: Transport | null = null;
  private storage: StorageAdapter | null = null;
  private device: DeviceInfo = DEFAULT_DEVICE;

  private session: SessionInfo | null = null;
  private sessionStartMs = 0;
  private sampled = true;
  private consent: ConsentState = 'unknown';
  private userId: string | null = null;
  /** Random id kept on this install so returning users can be counted. Not tied to any device or ad id. */
  private anonymousId = '';

  private queue: QueuedEvent[] = [];
  /** Events recorded while saved state is still loading. */
  private early: QueuedEvent[] | null = null;
  private sessions = new Map<string, SessionInfo>();
  private inFlight: Promise<void> | null = null;
  private timer: unknown = null;
  private backgroundedAt: number | null = null;

  private currentScreen: string | null = null;
  private scrollMax = new Map<string, number>();
  private pendingLabel: { label: string; at: number } | null = null;
  private capture: ScreenCapture | null = null;
  /** Screens already photographed on this install, as "screen|appVersion". */
  private shots = new Set<string>();
  private shooting = new Set<string>();

  // Recording (session replay frames)
  private recTimer: unknown = null;
  private recSampled = false;
  private recFrames = 0;
  private recBusy = false;
  private recLast: string | null | undefined = undefined;
  private recBuffer: { sessionId: string; t: number; image: string | null }[] = [];
  private recSending = false;
  private privacyHolds = 0;
  private keyboardOpen = false;
  /** Sessions the server already knows about, so their frames have somewhere to go. */
  private uploadedSessions = new Set<string>();

  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;

  constructor(deps: CoreDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
    this.setIntervalFn = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalFn =
      deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    this.setTimeoutFn = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  }

  // ---------------------------------------------------------------- setup

  async init(config: RecapConfig, device: Partial<DeviceInfo> = {}): Promise<void> {
    if (!config.appId) throw new Error('Recap: appId is required');
    this.config = config;
    this.storage = config.storage ?? null;
    this.device = {
      ...DEFAULT_DEVICE,
      ...device,
      appVersion: config.appVersion ?? device.appVersion ?? null,
    };
    this.transport =
      config.transport ??
      (config.supabase?.url && config.supabase.anonKey
        ? supabaseTransport(config.supabase)
        : config.endpoint
          ? endpointTransport(config.endpoint)
          : null);
    if (!this.transport) this.log('no transport configured; events stay on the device');

    this.anonymousId = uuid(this.random);

    // Start recording straight away; events captured while saved state loads are held back
    // until we know the user's stored consent choice.
    this.startSession();
    this.early = [];

    if (this.storage) {
      try {
        const saved = await this.storage.getItem(KEY_CONSENT);
        if (saved === 'granted' || saved === 'denied') this.consent = saved;
        const install = await this.storage.getItem(KEY_INSTALL);
        if (install) this.anonymousId = install;
        else await this.storage.setItem(KEY_INSTALL, this.anonymousId);
        if (this.session) this.session = { ...this.session, anonymousId: this.anonymousId };
        const shots = await this.storage.getItem(KEY_SHOTS);
        if (shots) for (const k of JSON.parse(shots) as string[]) this.shots.add(k);
        const raw = await this.storage.getItem(KEY_QUEUE);
        if (raw) {
          const parsed = JSON.parse(raw) as { queue?: QueuedEvent[]; sessions?: SessionInfo[] };
          for (const s of parsed.sessions ?? []) this.sessions.set(s.id, s);
          this.queue = (parsed.queue ?? []).filter((e) => this.sessions.has(e.sessionId));
        }
      } catch (err) {
        this.log('could not restore saved state', err);
      }
    }

    const early = this.early;
    this.early = null;
    if (this.session) this.sessions.set(this.session.id, this.session);
    if (this.isRecording()) for (const e of early) this.enqueue(e);

    if (this.timer) this.clearIntervalFn(this.timer);
    this.timer = this.setIntervalFn(
      () => void this.flush().then(() => this.sendFrames()),
      config.flushIntervalMs ?? 10_000,
    );
    this.startRecordingTimer();
  }

  async shutdown(): Promise<void> {
    if (this.timer) this.clearIntervalFn(this.timer);
    this.timer = null;
    if (this.recTimer) this.clearIntervalFn(this.recTimer);
    this.recTimer = null;
    await this.flush();
    await this.sendFrames();
  }

  // ---------------------------------------------------------------- consent

  /** Whether events are currently being recorded. */
  isRecording(): boolean {
    if (!this.config || !this.sampled) return false;
    if (this.consent === 'denied') return false;
    if (this.config.requireConsent && this.consent !== 'granted') return false;
    return true;
  }

  async optIn(): Promise<void> {
    this.consent = 'granted';
    await this.storage?.setItem(KEY_INSTALL, this.anonymousId);
    await this.storage?.setItem(KEY_CONSENT, 'granted');
  }

  /** Stops recording and deletes anything not yet uploaded. */
  async optOut(): Promise<void> {
    this.consent = 'denied';
    this.queue = [];
    this.recBuffer = [];
    // Forget the install id too, so a later opt-in can't be linked to earlier sessions.
    this.anonymousId = uuid(this.random);
    if (this.session) this.session = { ...this.session, anonymousId: this.anonymousId };
    await this.storage?.removeItem(KEY_INSTALL);
    await this.storage?.setItem(KEY_CONSENT, 'denied');
    await this.persist();
  }

  /**
   * Attach your own user id (or null to clear it). Use an internal id, never an email address.
   * Takes effect from the next upload of the current session.
   */
  setUserId(id: string | null): void {
    this.userId = id;
    if (this.session) {
      this.session = { ...this.session, userId: id };
      this.sessions.set(this.session.id, this.session);
    }
  }

  /** The random install id sent with each session (see `anonymousId` in the docs). */
  getAnonymousId(): string {
    return this.anonymousId;
  }

  getSessionId(): string | null {
    return this.session?.id ?? null;
  }

  // ---------------------------------------------------------------- capture

  screen(name: string, props: Record<string, unknown> = {}): void {
    if (!name || name === this.currentScreen) return;
    const from = this.currentScreen;
    this.currentScreen = name;
    this.record('screen', { from, ...props });
    this.maybeScreenshot(name);
  }

  /** Used by RecapProvider to plug in react-native-view-shot. */
  setScreenCapture(capture: ScreenCapture | null): void {
    this.capture = capture;
    if (capture && this.currentScreen) this.maybeScreenshot(this.currentScreen);
  }

  // ---------------------------------------------------------------- recordings

  private get recOptions(): RecordingOptions | null {
    const r = this.config?.recordings;
    if (!r) return null;
    return r === true ? {} : r;
  }

  private startRecordingTimer(): void {
    const opt = this.recOptions;
    if (this.recTimer) this.clearIntervalFn(this.recTimer);
    this.recTimer = null;
    if (!opt) return;
    this.recTimer = this.setIntervalFn(() => void this.recordFrame(), Math.max(250, opt.intervalMs ?? 1000));
  }

  /**
   * Pause recording frames while something private is on screen. Returns a function that ends
   * the pause. <RecapPrivate> does this for you.
   */
  holdPrivacy(): () => void {
    this.privacyHolds++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.privacyHolds = Math.max(0, this.privacyHolds - 1);
    };
  }

  /** RecapProvider calls this as the keyboard opens and closes; recording pauses while typing. */
  setKeyboardOpen(open: boolean): void {
    this.keyboardOpen = open;
  }

  /** Why recording is paused right now, or null if it isn't. */
  private recordingPausedFor(): string | null {
    const opt = this.recOptions;
    if (this.keyboardOpen) return 'keyboard';
    if (this.privacyHolds > 0) return 'private';
    if (opt?.exclude && this.currentScreen && opt.exclude.includes(this.currentScreen)) return 'excluded';
    return null;
  }

  /** Takes one frame. Runs on a timer; exposed for tests. */
  async recordFrame(): Promise<void> {
    const opt = this.recOptions;
    if (!opt || !this.capture || !this.transport?.sendFrames || !this.session) return;
    if (!this.isRecording() || !this.recSampled || this.backgroundedAt !== null || this.recBusy) return;
    if (this.recFrames >= (opt.maxFrames ?? 600)) return;
    const sessionId = this.session.id;
    const t = Math.max(0, this.now() - this.sessionStartMs);
    if (this.recordingPausedFor()) {
      // One marker per pause, so the replay can say "Hidden for privacy".
      if (this.recLast !== null) this.pushFrame(sessionId, t, null);
      return;
    }
    this.recBusy = true;
    try {
      const raw = await this.capture({ width: opt.width ?? 280, quality: opt.quality ?? 0.4 });
      // Something private may have appeared while the picture was being taken.
      if (!raw || this.recordingPausedFor() || this.session?.id !== sessionId) return;
      const image = raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;
      if (image === this.recLast) return; // nothing changed on screen
      this.pushFrame(sessionId, t, image);
    } catch (err) {
      this.log('recording frame failed', err);
    } finally {
      this.recBusy = false;
    }
  }

  private pushFrame(sessionId: string, t: number, image: string | null): void {
    this.recLast = image;
    this.recFrames++;
    this.recBuffer.push({ sessionId, t, image });
    // Frames are big, so they are never saved to the phone; keep only a short backlog while offline.
    if (this.recBuffer.length > 30) this.recBuffer.splice(0, this.recBuffer.length - 30);
    if (this.recBuffer.length >= 5) void this.sendFrames();
  }

  private async sendFrames(): Promise<void> {
    const transport = this.transport;
    if (this.recSending || !transport?.sendFrames || this.recBuffer.length === 0 || this.consent === 'denied') return;
    this.recSending = true;
    try {
      // The session has to reach the database before its frames can.
      if (this.recBuffer.some((f) => !this.uploadedSessions.has(f.sessionId))) await this.flush();
      while (this.recBuffer.length) {
        const sessionId = this.recBuffer[0]!.sessionId;
        if (!this.uploadedSessions.has(sessionId)) break;
        const batch = this.recBuffer.filter((f) => f.sessionId === sessionId).slice(0, 10);
        const payload: FramesPayload = {
          appId: this.config!.appId,
          sessionId,
          frames: batch.map(({ t, image }) => ({ t, image })),
        };
        await transport.sendFrames(payload);
        const sent = new Set(batch);
        this.recBuffer = this.recBuffer.filter((f) => !sent.has(f));
        this.log(`uploaded ${batch.length} recording frames`);
      }
    } catch (err) {
      this.log('frame upload failed; will retry', err);
    } finally {
      this.recSending = false;
    }
  }

  private maybeScreenshot(name: string): void {
    const opt = this.config?.screenshots;
    if (!opt || !this.capture || !this.transport?.sendScreenshot || !this.isRecording()) return;
    if (typeof opt === 'object' && opt.exclude?.includes(name)) return;
    const key = `${name}|${this.device.appVersion ?? ''}`;
    if (this.shots.has(key) || this.shooting.has(key)) return;
    this.shooting.add(key);
    const delay = typeof opt === 'object' && opt.delayMs != null ? opt.delayMs : 1200;
    // Wait for the screen to finish drawing, and skip it if the user has already moved on.
    this.setTimeoutFn(() => void this.takeScreenshot(name, key), delay);
  }

  private async takeScreenshot(name: string, key: string): Promise<void> {
    try {
      if (this.currentScreen !== name || !this.capture || !this.transport?.sendScreenshot) return;
      const base64 = await this.capture();
      if (!base64 || this.currentScreen !== name) return;
      await this.transport.sendScreenshot({
        appId: this.config!.appId,
        screen: name,
        platform: this.device.platform,
        appVersion: this.device.appVersion,
        width: this.device.screenWidth,
        height: this.device.screenHeight,
        image: base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`,
      });
      this.shots.add(key);
      this.log(`screenshot of ${name} saved`);
      await this.storage?.setItem(KEY_SHOTS, JSON.stringify([...this.shots].slice(-500)));
    } catch (err) {
      this.log(`screenshot of ${name} failed`, err);
    } finally {
      this.shooting.delete(key);
    }
  }

  tap(input: TapInput): void {
    const w = this.device.screenWidth || 1;
    const h = this.device.screenHeight || 1;
    let label = input.label ?? null;
    const t = this.now();
    if (!label && this.pendingLabel && t - this.pendingLabel.at <= LABEL_WINDOW_MS) {
      label = this.pendingLabel.label;
    }
    this.pendingLabel = null;
    this.record('tap', {
      x: Math.round(input.x),
      y: Math.round(input.y),
      nx: clamp01(input.x / w),
      ny: clamp01(input.y / h),
      label,
    });
  }

  /**
   * Name the thing the user just pressed. Call it from onPress, or use recapPress().
   * It labels the tap recorded just before or just after it.
   */
  labelTap(label: string): void {
    const t = this.now();
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const e = this.queue[i]!;
      if (e.type !== 'tap') continue;
      const tapAt = this.sessionStartMs + e.t;
      if (t - tapAt <= LABEL_WINDOW_MS && e.data.label == null && e.sessionId === this.session?.id) {
        e.data.label = label;
        return;
      }
      break;
    }
    this.pendingLabel = { label, at: t };
  }

  /** Report scroll depth (0 to 100) for the current screen. Only milestones and new maximums are kept. */
  scroll(depth: number, screen: string | null = this.currentScreen): void {
    const key = screen ?? '';
    const d = Math.max(0, Math.min(100, Math.round(depth)));
    const prev = this.scrollMax.get(key) ?? 0;
    if (d <= prev) return;
    this.scrollMax.set(key, d);
    const crossed = SCROLL_MILESTONES.filter((m) => prev < m && d >= m);
    if (crossed.length === 0) return;
    this.record('scroll', { depth: crossed[crossed.length - 1], maxDepth: d });
  }

  track(name: string, props: Record<string, unknown> = {}): void {
    this.record('custom', { name, ...props });
  }

  /** Call with the React Native AppState value. Starts a fresh session after a long time away. */
  appState(state: string): void {
    const t = this.now();
    if (state === 'background' || state === 'inactive') {
      if (this.backgroundedAt !== null) return;
      this.backgroundedAt = t;
      this.record('app_state', { state: 'background' });
      void this.flush().then(() => this.sendFrames());
      return;
    }
    if (state === 'active' && this.backgroundedAt !== null) {
      const away = t - this.backgroundedAt;
      this.backgroundedAt = null;
      const timeout = this.config?.sessionTimeoutMs ?? 30 * 60_000;
      if (away >= timeout) {
        const screen = this.currentScreen;
        this.startSession();
        if (screen) this.screen(screen, { resumed: true });
      } else {
        this.record('app_state', { state: 'active', awayMs: away });
      }
    }
  }

  // ---------------------------------------------------------------- upload

  /** Upload everything queued. Safe to call at any time; overlapping calls wait for each other. */
  async flush(): Promise<void> {
    while (this.inFlight) await this.inFlight;
    if (!this.transport || this.queue.length === 0 || this.consent === 'denied') return;
    this.inFlight = this.upload();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async upload(): Promise<void> {
    const transport = this.transport!;
    try {
      const max = this.config?.maxBatchSize ?? 50;
      // Uploads go one session at a time, oldest first.
      while (this.queue.length > 0) {
        const sessionId = this.queue[0]!.sessionId;
        const session = this.sessions.get(sessionId);
        const batch: QueuedEvent[] = [];
        for (const e of this.queue) {
          if (e.sessionId !== sessionId) continue;
          batch.push(e);
          if (batch.length >= max) break;
        }
        if (!session) {
          this.queue = this.queue.filter((e) => e.sessionId !== sessionId);
          continue;
        }
        const payload: IngestBatch = {
          appId: this.config!.appId,
          sdkVersion: SDK_VERSION,
          session,
          events: batch.map(({ sessionId: _s, ...e }) => e),
        };
        await transport.send(payload);
        this.uploadedSessions.add(sessionId);
        const sent = new Set(batch);
        this.queue = this.queue.filter((e) => !sent.has(e));
        this.log(`uploaded ${batch.length} events`);
      }
      this.pruneSessions();
    } catch (err) {
      this.log('upload failed; will retry', err);
    } finally {
      await this.persist();
    }
  }

  /** Events waiting to be uploaded. Useful for tests and an in-app debug view. */
  pending(): readonly RecapEvent[] {
    return this.queue;
  }

  // ---------------------------------------------------------------- internals

  private startSession(): void {
    this.sessionStartMs = this.now();
    const rate = this.config?.sampleRate ?? 1;
    this.sampled = rate >= 1 || this.random() < rate;
    const recRate = this.recOptions?.sampleRate ?? 1;
    this.recSampled = recRate >= 1 || this.random() < recRate;
    this.recFrames = 0;
    this.recLast = undefined;
    this.currentScreen = null;
    this.scrollMax.clear();
    this.pendingLabel = null;
    this.session = {
      id: uuid(this.random),
      startedAt: new Date(this.sessionStartMs).toISOString(),
      userId: this.userId,
      anonymousId: this.anonymousId,
      device: this.device,
    };
    this.sessions.set(this.session.id, this.session);
    this.log(`session ${this.session.id} started${this.sampled ? '' : ' (not sampled)'}`);
  }

  private record(type: RecapEventType, data: Record<string, unknown>): void {
    if (!this.session) return;
    const t = this.now();
    const event: QueuedEvent = {
      sessionId: this.session.id,
      type,
      t: Math.max(0, t - this.sessionStartMs),
      at: new Date(t).toISOString(),
      screen: this.currentScreen,
      data,
    };
    if (this.early) {
      // Still loading: keep it unless consent is clearly off, decide once loaded.
      if (this.sampled && this.consent !== 'denied' && this.early.length < 200) this.early.push(event);
      return;
    }
    if (!this.isRecording()) return;
    this.enqueue(event);
  }

  private enqueue(event: QueuedEvent): void {
    this.queue.push(event);
    const max = this.config?.maxQueueSize ?? 1000;
    if (this.queue.length > max) this.queue.splice(0, this.queue.length - max);
    if (this.queue.length >= (this.config?.maxBatchSize ?? 50)) void this.flush();
  }

  private pruneSessions(): void {
    const live = new Set(this.queue.map((e) => e.sessionId));
    if (this.session) live.add(this.session.id);
    for (const id of this.sessions.keys()) if (!live.has(id)) this.sessions.delete(id);
  }

  private async persist(): Promise<void> {
    if (!this.storage) return;
    try {
      this.pruneSessions();
      await this.storage.setItem(
        KEY_QUEUE,
        JSON.stringify({ queue: this.queue, sessions: [...this.sessions.values()] }),
      );
    } catch (err) {
      this.log('could not save queue', err);
    }
  }

  private log(...args: unknown[]): void {
    if (this.config?.debug) console.log('[Recap]', ...args);
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
}
