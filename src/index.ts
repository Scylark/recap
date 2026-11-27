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

// --- State ---

/** The visitor's choice, kept in this browser: 'granted' after optIn(), 'denied' after optOut(). */
const KEY_CONSENT = 'recap-consent';
type Consent = 'granted' | 'denied' | 'unknown';

let _initialized = false;
let _destroyFns: Array<() => void> = [];
/** Listeners for the panel's shortcut and touch-hold, re-made whenever init() changes them. */
let _panelStops: Array<() => void> = [];
/** Every setting given so far: later init() calls change only the keys they pass. */
let _config: RecapConfig = {};
/** Settings from the script tag's data-* attributes, under anything init() passes. */
let _scriptDefaults: RecapConfig = {};
let _remote: RemoteSink | null = null;
let _remoteConfig: RemoteConfig | null = null;
/** Events seen before the dashboard connection started, so the first page view isn't lost. */
let _early: AnyEvent[] = [];
let _consent: Consent | null = null; // null: not read from storage yet

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

/** Whether events may be recorded right now (consent and opt-out). */
function allowed(): boolean {
  const c = consent();
  if (c === 'denied') return false;
  if (_config.requireConsent && c !== 'granted') return false;
  return true;
}

function capture(e: AnyEvent): void {
  if (!allowed()) return;
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
  setLabelMode(_config.labels ?? (_remoteConfig || _remote ? 'attributes' : 'text'));
}

function connectIfAllowed(): void {
  if (_remote || !_remoteConfig || !_initialized || !allowed()) return;
  try {
    const sink = new RemoteSink(_remoteConfig);
    if (!sink.start()) return;
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
   * the settings they pass (panel, labels, screen names, consent, dashboard connection).
   */
  init(config: RecapConfig = {}): void {
    _config = { ..._scriptDefaults, ..._config, ...given(config) };
    if (config.sessionName) setSessionName(config.sessionName);
    if (config.endpoint) setEndpoint(config.endpoint);
    if (!_remoteConfig) _remoteConfig = remoteFrom(_config);
    setScreenNamer(_config.screenName);
    refreshLabels();

    const first = !_initialized;
    if (first) {
      _initialized = true;
      startCapture(_config);
    }
    // The first call opens the panel if any setting asks; later calls only if they ask themselves.
    applyPanel(first ? _config.showPanel === true : config.showPanel === true);
    connectIfAllowed();
  },

  /**
   * Send this session to your Recap dashboard as well (Supabase or an endpoint). Call init() first.
   * Safe to call more than once; only the first settings are used. With `requireConsent`, the
   * connection starts once the visitor opts in.
   */
  connect(config: RemoteConfig): void {
    if (!_remoteConfig) _remoteConfig = config;
    refreshLabels();
    connectIfAllowed();
  },

  /**
   * The visitor agreed to analytics: start recording (and sending, if connected). Remembered in
   * this browser. Needed only with `requireConsent`, or after optOut().
   */
  optIn(): void {
    const was = _initialized && allowed();
    saveConsent('granted');
    resumeAfterOptIn(was);
  },

  /**
   * The visitor said no: stop recording and sending, and delete everything not yet sent.
   * Remembered in this browser until optIn().
   */
  optOut(): void {
    saveConsent('denied');
    stopAfterOptOut();
  },

  /** Whether Recap is recording now: started, and not waiting for consent or opted out. */
  isRecording(): boolean {
    return _initialized && allowed();
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
    _early = [];
    _config = {};
    _consent = null;
    setScreenNamer(null);
    setLabelMode('text');
    _initialized = false;
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
  if (!_initialized) return;
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
  const was = _initialized && allowed();
  _consent = null; // read it again
  if (consent() === 'denied') stopAfterOptOut();
  else if (consent() === 'granted') resumeAfterOptIn(was);
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

/** (Re)make the panel's shortcut and touch-hold from the current settings. */
function applyPanel(show: boolean): void {
  _panelStops.forEach((fn) => fn());
  _panelStops = [];
  const c = _config;

  if (c.panel === false) {
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
