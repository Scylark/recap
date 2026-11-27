// Recap UX — main entry point.
//
// Imported as a module (ES or CommonJS), nothing starts until you call Recap.init(). The script-tag
// build (dist/recap.min.js, built from src/browser.ts) starts itself from the tag's data-* attributes.

import type { RecapConfig, AnyEvent } from './types.js';
import { getSessionId, setSessionName } from './capture/session.js';
import { initClickCapture } from './capture/clicks.js';
import { initScrollCapture, refreshScrollCapture } from './capture/scroll.js';
import { initNavigationCapture, emitCurrentPage } from './capture/navigation.js';
import { initBuffer, flush, push, getBuffer, clearBuffer } from './storage/buffer.js';
import { saveEvents, purgeOldSessions, deleteLocalData } from './storage/idb.js';
import { setEndpoint, sendBeaconBatch, hasEndpoint } from './storage/beacon.js';
import { openPanel, closePanel, isPanelOpen } from './viz/panel.js';
import { initTouchTrigger, type TouchTriggerOptions } from './capture/touch-trigger.js';
import { summarize } from './analysis/summarize.js';
import { exportJSON, exportCSV, exportSummaryJSON } from './storage/export.js';
import { RemoteSink, type RemoteConfig } from './remote/remote.js';
import { setLabelMode, setScreenNamer } from './privacy/sanitize.js';
import {
  gpcOn,
  hostAllowed,
  inFrame,
  pathExcluded,
  readTabSwitch,
  secretKeyKind,
  secretKeyMessage,
  type RecapStatus,
  type RecapStatusReason,
  type TabSwitch,
} from './gate.js';

// --- State ---

/** The visitor's choice, kept in this browser: 'granted' after optIn(), 'denied' after optOut(). */
const KEY_CONSENT = 'recap-consent';
type Consent = 'granted' | 'denied' | 'unknown';

/** init() has been called, so the settings are known. */
let _initialized = false;
/** The capture listeners are running. Not on a page the gate stops (wrong host, GPC, a frame...). */
let _capturing = false;
let _destroyFns: Array<() => void> = [];
/** Listeners for the panel's shortcut and touch-hold, re-made whenever init() changes them. */
let _panelStops: Array<() => void> = [];
/** Every setting given so far: later init() calls change only the keys they pass. */
let _config: RecapConfig = {};
/** Settings from the script tag's data-* attributes, under anything init() passes. */
let _scriptDefaults: RecapConfig = {};
let _remote: RemoteSink | null = null;
let _remoteConfig: RemoteConfig | null = null;
/** This session was left out by the dashboard's sampleRate: don't try to connect again. */
let _unsampled = false;
/** Events seen before the dashboard connection started, so the first page view isn't lost. */
let _early: AnyEvent[] = [];
let _consent: Consent | null = null; // null: not read from storage yet
/** This tab's ?recap= switch. undefined: not read yet. */
let _switch: TabSwitch | undefined;
/** The key last checked for being a secret one, and the answer. */
let _keyChecked: string | undefined;
let _secretKey: 'service_role' | 'sb_secret' | null = null;
/** This page load has been on a path in excludePaths: page recording stays off until the next load. */
let _sawExcludedPath = false;
/** The status reason last logged in debug mode, so each is logged once. */
let _loggedReason: RecapStatusReason | null = null;

function consent(): Consent {
  if (_consent === null) {
    try {
      const saved = localStorage.getItem(KEY_CONSENT);
      _consent = saved === 'granted' || saved === 'denied' ? saved : 'unknown';
    } catch {
      _consent = 'unknown';
    }
  }
  return _consent;
}

function saveConsent(value: 'granted' | 'denied'): void {
  _consent = value;
  try {
    localStorage.setItem(KEY_CONSENT, value);
  } catch {
    // Storage blocked: the choice holds for this page only.
  }
}

// --- The live-site gate ---

function tabSwitch(): TabSwitch {
  if (_switch === undefined) _switch = typeof location !== 'undefined' ? readTabSwitch(location.search) : null;
  return _switch;
}

/** Sessions go to a dashboard: `supabase`, `remote` or connect(). The live-site defaults apply. */
function connected(): boolean {
  return _remoteConfig !== null || _remote !== null;
}

function debugOn(): boolean {
  const sw = tabSwitch();
  return _config.debug === true || sw === 'on' || sw === 'record';
}

/** A secret Supabase key anywhere in the settings, checked (and reported) once per key. */
function secretKey(): 'service_role' | 'sb_secret' | null {
  const key = _remoteConfig?.supabase?.anonKey ?? _config.supabase?.anonKey;
  if (key !== _keyChecked) {
    _keyChecked = key;
    _secretKey = secretKeyKind(key) ?? secretKeyKind(_config.supabase?.anonKey);
    if (_secretKey) console.error(secretKeyMessage(_secretKey));
  }
  return _secretKey;
}

/** What stops Recap on this page as a whole. These don't change while the page is open. */
function pageBlock(): RecapStatusReason | null {
  const sw = tabSwitch();
  if (sw === 'off') return 'switched-off';
  const live = connected();
  if (!(_config.allowInFrames ?? !live) && inFrame()) return 'in-frame';
  if (secretKey()) return 'secret-key';
  const hosts = _config.hosts;
  const hostname = typeof location !== 'undefined' ? location.hostname : '';
  if (hosts && sw !== 'on' && sw !== 'record' && !hostAllowed(hostname, hosts)) return 'host-not-listed';
  if ((_config.respectGPC ?? live) && gpcOn()) return 'gpc';
  return null;
}

/** What stops recording right now, or null: the page, then its path, then consent and opt-out. */
function blockReason(): RecapStatusReason | null {
  const page = pageBlock();
  if (page) return page;
  if (typeof location !== 'undefined' && pathExcluded(location.pathname, _config.excludePaths)) return 'excluded-path';
  const c = consent();
  if (c === 'denied') return 'opted-out';
  if (_config.requireConsent && c !== 'granted') return 'consent-needed';
  return null;
}

/** Whether events may be recorded right now (the gate, consent and opt-out). */
function allowed(): boolean {
  return blockReason() === null;
}

function currentStatus(): RecapStatus {
  if (!_initialized) return { running: false, recording: false, reason: 'not-started' };
  const reason = blockReason() ?? (_capturing ? 'running' : 'not-started');
  const running = reason === 'running';
  return { running, recording: running && (_remote?.isRecordingPage() ?? false), reason };
}

function explain(reason: RecapStatusReason): string {
  switch (reason) {
    case 'switched-off':
      return '?recap=off is set for this tab; open the page with ?recap=auto to clear it';
    case 'in-frame':
      return 'the page is inside an iframe; set allowInFrames: true to run there';
    case 'secret-key':
      return 'the Supabase key is a secret key; use the anon or publishable key';
    case 'host-not-listed':
      return `${location.hostname} is not in hosts; add ?recap=on to the address to test here`;
    case 'excluded-path':
      return `${location.pathname} matches excludePaths`;
    case 'gpc':
      return 'this browser sends Global Privacy Control (respectGPC)';
    case 'opted-out':
      return 'Recap.optOut() was called in this browser; Recap.optIn() undoes it';
    case 'consent-needed':
      return 'requireConsent is on and Recap.optIn() has not been called';
    default:
      return reason;
  }
}

/** In debug mode, say why Recap is or isn't running, once for each reason. */
function reportStatus(): void {
  if (!_initialized || !debugOn()) return;
  const { reason } = currentStatus();
  if (reason === _loggedReason) return;
  _loggedReason = reason;
  if (reason === 'running') {
    console.log(`[Recap] running: ${connected() ? 'sending sessions to the dashboard' : 'keeping data in this browser'}`);
  } else {
    console.log(`[Recap] not running: ${reason} (${explain(reason)})`);
  }
}

/** The page went to a path in excludePaths: no page recording until the next full page load. */
function onExcludedPath(): void {
  if (_sawExcludedPath) return;
  _sawExcludedPath = true;
  _remote?.blockRecording('recordings are off for the rest of this page: it went to a page in excludePaths');
}

function capture(e: AnyEvent): void {
  const reason = blockReason();
  if (reason) {
    if (reason === 'excluded-path') onExcludedPath();
    reportStatus();
    return;
  }
  if (!_remote) connectIfAllowed(); // e.g. a single-page app left an excluded page
  reportStatus();
  push(e);
  if (_remote) _remote.handle(e);
  else if (_early.length < 200) _early.push(e);
}

/** Drop keys passed as undefined, so they don't wipe earlier settings. */
function given(config: RecapConfig): RecapConfig {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) if (v !== undefined) out[k] = v;
  return out as RecapConfig;
}

function refreshLabels(): void {
  // Text stays in the browser in the default mode, so it may label taps there. Once sessions go to
  // a dashboard, only attributes made for labelling are used unless the app says otherwise.
  setLabelMode(_config.labels ?? (connected() ? 'attributes' : 'text'));
}

/** The dashboard settings with this page's debug and query-string settings on top. */
function sinkConfig(rc: RemoteConfig): RemoteConfig {
  return {
    ...rc,
    ...(debugOn() ? { debug: true } : {}),
    ...(rc.stripQueryParams === undefined && _config.stripQueryParams === false ? { stripQueryParams: false } : {}),
  };
}

function connectIfAllowed(): void {
  if (_remote || _unsampled || !_remoteConfig || !_capturing || !allowed()) return;
  try {
    const sw = tabSwitch();
    const sink = new RemoteSink(sinkConfig(_remoteConfig), undefined, {
      sampleIn: sw === 'on' || sw === 'record',
      recordIn: sw === 'record',
    });
    if (_sawExcludedPath) sink.blockRecording('recordings are off for this page: it was on a page in excludePaths');
    if (!sink.start()) {
      _unsampled = true;
      _early = [];
      return;
    }
    _remote = sink;
    for (const e of _early) sink.handle(e);
    _early = [];
  } catch (err) {
    console.error('[Recap] Could not connect:', err);
  }
}

// --- Public API ---

export const Recap = {
  /**
   * Start Recap, or change its settings. The first call starts capturing; later calls change only
   * the settings they pass (panel, labels, screen names, consent, dashboard connection). On a page
   * the gate stops (see status()), nothing starts.
   */
  init(config: RecapConfig = {}): void {
    _config = { ..._scriptDefaults, ..._config, ...given(config) };
    if (config.sessionName) setSessionName(config.sessionName);
    if (config.endpoint) setEndpoint(config.endpoint);
    if (!_remoteConfig) _remoteConfig = remoteFrom(_config);
    setScreenNamer(_config.screenName);
    refreshLabels();
    _initialized = true;

    const starting = !_capturing && pageBlock() === null;
    if (starting) {
      _capturing = true;
      startCapture(_config);
    }
    // The first call opens the panel if any setting asks; later calls only if they ask themselves.
    applyPanel(starting ? _config.showPanel === true : config.showPanel === true);
    connectIfAllowed();
    reportStatus();
  },

  /**
   * Send this session to your Recap dashboard as well (Supabase or an endpoint). Call init() first.
   * Safe to call more than once; only the first settings are used. With `requireConsent`, the
   * connection starts once the visitor opts in. The live-site defaults apply from here on: the
   * panel is off unless `panel: true`, labels come from attributes, GPC is respected and nothing
   * runs inside an iframe.
   */
  connect(config: RemoteConfig): void {
    if (!_remoteConfig) _remoteConfig = config;
    refreshLabels();
    if (_initialized) applyPanel(false);
    connectIfAllowed();
    reportStatus();
  },

  /**
   * The visitor agreed to analytics: start recording (and sending, if connected). Remembered in
   * this browser. Needed only with `requireConsent`, or after optOut().
   */
  optIn(): void {
    const was = _capturing && allowed();
    saveConsent('granted');
    resumeAfterOptIn(was);
    reportStatus();
  },

  /**
   * The visitor said no: stop recording and sending, and delete everything not yet sent.
   * Remembered in this browser until optIn().
   */
  optOut(): void {
    saveConsent('denied');
    stopAfterOptOut();
    reportStatus();
  },

  /** Whether Recap is recording now: started, and not stopped by the gate, consent or opt-out. */
  isRecording(): boolean {
    return _capturing && allowed();
  },

  /**
   * Whether Recap is running on this page and, if not, why: `{ running, recording, reason }`.
   * `recording` is true while this tab's page is recorded for replay. `reason` is `'running'`, or
   * what stops it: `'not-started'`, `'host-not-listed'`, `'excluded-path'`, `'gpc'`, `'opted-out'`,
   * `'consent-needed'`, `'in-frame'`, `'secret-key'` or `'switched-off'`.
   */
  status(): RecapStatus {
    return currentStatus();
  },

  /** Record a custom event, e.g. Recap.track('added_to_basket', { sku: 'A1' }). Sent only when connected. */
  track(name: string, props: Record<string, unknown> = {}): void {
    if (!allowed()) return;
    _remote?.track(name, props);
  },

  /** Manually flush the event buffer. */
  flush(): Promise<void> {
    return Promise.all([flush(), _remote?.flush()]).then(() => undefined);
  },

  /** Get the current session ID. */
  getSessionId(): string {
    return getSessionId();
  },

  /** Open the researcher panel programmatically. */
  openPanel(): Promise<void> {
    return flush().then(() => openPanel());
  },

  /** Close the researcher panel. */
  closePanel(): void {
    closePanel();
  },

  /** Export current session as JSON. */
  exportJSON(): void {
    const events = getBuffer();
    exportJSON(events);
  },

  /** Export current session as CSV. */
  exportCSV(): void {
    const events = getBuffer();
    exportCSV(events);
  },

  /** Export AI summary. */
  exportAI(): void {
    const events = getBuffer();
    const summary = summarize(events);
    exportSummaryJSON(summary);
  },

  /** Tear down all listeners and clean up. */
  destroy(): void {
    _destroyFns.forEach((fn) => fn());
    _destroyFns = [];
    _panelStops.forEach((fn) => fn());
    _panelStops = [];
    _remote?.stop();
    _remote = null;
    _remoteConfig = null;
    _unsampled = false;
    _early = [];
    _config = {};
    _consent = null;
    _switch = undefined;
    _keyChecked = undefined;
    _secretKey = null;
    _sawExcludedPath = false;
    _loggedReason = null;
    setScreenNamer(null);
    setLabelMode('text');
    _initialized = false;
    _capturing = false;
  },
};

// --- Consent ---

/** Stop recording and sending, and delete everything not yet sent and the copy kept in this browser. */
function stopAfterOptOut(): void {
  _remote?.discard();
  _remote = null;
  _early = [];
  clearBuffer();
  void deleteLocalData();
}

function resumeAfterOptIn(wasRecording: boolean): void {
  if (!_capturing) return;
  connectIfAllowed();
  // Start the session on the page they're on, since nothing was recorded until now.
  if (!wasRecording && allowed()) emitCurrentPage();
}

/**
 * The choice is per browser, so another open tab of the same site follows it at once: an opt-out
 * made in one tab stops this one too (and it doesn't recreate what that tab deleted).
 */
function onConsentChangedElsewhere(e: StorageEvent): void {
  if (e.key !== KEY_CONSENT && e.key !== null) return; // null: storage cleared
  const was = _capturing && allowed();
  _consent = null; // read it again
  if (consent() === 'denied') stopAfterOptOut();
  else if (consent() === 'granted') resumeAfterOptIn(was);
  reportStatus();
}

/**
 * Settings read from the script tag's data-* attributes (script-tag build only). init() puts
 * anything it is given on top of these.
 * @internal
 */
export function setScriptDefaults(config: RecapConfig): void {
  _scriptDefaults = given(config);
}

// --- Capture ---

function startCapture(config: RecapConfig): void {
  const strip = config.stripQueryParams !== false; // default true

  // Purge old sessions (not for a visitor who opted out: that would recreate the deleted database)
  if (consent() !== 'denied') void purgeOldSessions();

  // Set up event buffer → IDB + optional beacon
  const stopBuffer = initBuffer(async (events: AnyEvent[]) => {
    await saveEvents(events);
    if (hasEndpoint()) await sendBeaconBatch(events);
  });
  _destroyFns.push(stopBuffer);

  // Follow an opt-in or opt-out made in another tab.
  window.addEventListener('storage', onConsentChangedElsewhere);
  _destroyFns.push(() => window.removeEventListener('storage', onConsentChangedElsewhere));

  // Start capture layers
  const stopClicks = initClickCapture(capture, strip);
  const stopScroll = initScrollCapture(capture, strip);
  const stopNav = initNavigationCapture((e) => {
    capture(e);
    if (e.method !== 'pageload') refreshScrollCapture();
  }, strip);

  _destroyFns.push(stopClicks, stopScroll, stopNav);

  // Flush on page hide
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void flush();
  };
  document.addEventListener('visibilitychange', onHide);
  _destroyFns.push(() => document.removeEventListener('visibilitychange', onHide));
}

// --- Researcher panel ---

function togglePanel(): void {
  if (isPanelOpen()) {
    closePanel();
  } else {
    void flush().then(() => openPanel());
  }
}

/**
 * Whether the panel, its shortcut and its touch-hold are on: `panel` if set, otherwise on while data
 * stays in the browser and off once sessions go to a dashboard. Never on a page the gate stops.
 */
function panelOn(): boolean {
  return _capturing && pageBlock() === null && (_config.panel ?? !connected());
}

/** (Re)make the panel's shortcut and touch-hold from the current settings. */
function applyPanel(show: boolean): void {
  _panelStops.forEach((fn) => fn());
  _panelStops = [];
  const c = _config;

  if (!panelOn()) {
    if (isPanelOpen()) closePanel();
    return;
  }

  // Keyboard shortcut to toggle panel
  if (c.shortcut !== false) {
    const shortcut = c.shortcut ?? 'Alt+Shift+Y';
    const onKey = (e: KeyboardEvent): void => {
      // Ignore auto-repeat: holding the combo must not open and close the panel repeatedly.
      if (e.repeat) return;
      if (matchesShortcut(e, shortcut)) {
        e.preventDefault();
        togglePanel();
      }
    };
    // Capture phase on window, so the shortcut still fires when the page's own
    // handlers stop propagation or focus sits on an element that swallows keys.
    window.addEventListener('keydown', onKey, true);
    _panelStops.push(() => window.removeEventListener('keydown', onKey, true));
  }

  // Touch-hold gesture to toggle panel (no keyboard on mobile/in-person tests)
  if (c.touchTrigger !== false) {
    const touchTriggerOptions: Partial<TouchTriggerOptions> = {};
    if (c.touchTriggerFingers !== undefined) touchTriggerOptions.fingerCount = c.touchTriggerFingers;
    if (c.touchTriggerHoldMs !== undefined) touchTriggerOptions.holdMs = c.touchTriggerHoldMs;
    _panelStops.push(initTouchTrigger(togglePanel, touchTriggerOptions));
  }

  if (show) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => void openPanel(), { once: true });
    } else {
      void openPanel();
    }
  }
}

// --- Dashboard connection ---

/** The settings for sending to the Recap dashboard, if the config has any. */
function remoteFrom(config: RecapConfig): RemoteConfig | null {
  if (config.remote) return config.remote;
  if (!config.supabase?.url || !config.supabase.anonKey) return null;
  return {
    appId: config.appId || (typeof location !== 'undefined' ? location.hostname : '') || 'web',
    supabase: { url: config.supabase.url, anonKey: config.supabase.anonKey },
    ...(config.appVersion ? { appVersion: config.appVersion } : {}),
    ...(config.recordings ? { recordings: config.recordings } : {}),
    ...(config.debug ? { debug: true } : {}),
  };
}

// --- Keyboard shortcut matching ---

function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const isMac =
    typeof navigator !== 'undefined' &&
    (navigator.platform?.toLowerCase().includes('mac') ||
      (navigator as unknown as { userAgentData?: { platform: string } }).userAgentData?.platform
        ?.toLowerCase()
        .includes('mac'));

  const parts = shortcut.toUpperCase().split('+');
  const key = parts[parts.length - 1]!;
  const needsCtrl = parts.includes('CTRL');
  const needsShift = parts.includes('SHIFT');
  const needsMeta = parts.includes('META') || parts.includes('CMD');
  const needsAlt = parts.includes('ALT');

  const ctrlOrMeta = isMac ? e.metaKey : e.ctrlKey;
  // Use e.code (e.g. "KeyH") so Alt/Option combos don't produce unexpected characters
  const codeKey = e.code.replace(/^Key/, '').replace(/^Digit/, '');

  return (
    codeKey === key &&
    (!needsCtrl || ctrlOrMeta) &&
    (!needsShift || e.shiftKey) &&
    (!needsMeta || e.metaKey) &&
    (!needsAlt || e.altKey)
  );
}

// Named exports for ESM / React consumers
export { summarize } from './analysis/summarize.js';
export type * from './types.js';
export default Recap;
