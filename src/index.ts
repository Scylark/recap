// Recap UX — main entry point.
// Auto-initializes from <script> tag data-* attributes.

import type { RecapConfig, AnyEvent } from './types.js';
import { getSessionId, setSessionName } from './capture/session.js';
import { initClickCapture } from './capture/clicks.js';
import { initScrollCapture, refreshScrollCapture } from './capture/scroll.js';
import { initNavigationCapture } from './capture/navigation.js';
import { initBuffer, flush, push, getBuffer } from './storage/buffer.js';
import { saveEvents, purgeOldSessions } from './storage/idb.js';
import { setEndpoint, sendBeaconBatch, hasEndpoint } from './storage/beacon.js';
import { setSupabase, hasSupabase, sendToSupabase } from './storage/supabase.js';
import { openPanel, closePanel, isPanelOpen } from './viz/panel.js';
import { initTouchTrigger, type TouchTriggerOptions } from './capture/touch-trigger.js';
import { summarize } from './analysis/summarize.js';
import { exportJSON, exportCSV, exportSummaryJSON } from './storage/export.js';

// --- State ---

let _initialized = false;
let _destroyFns: Array<() => void> = [];

// --- Public API ---

export const Recap = {
  /**
   * Initialize the tracker with optional config.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  init(config: RecapConfig = {}): void {
    if (_initialized) return;
    _initialized = true;

    // Apply config
    if (config.sessionName) setSessionName(config.sessionName);
    if (config.endpoint) setEndpoint(config.endpoint);
    if (config.supabase?.url && config.supabase.anonKey) {
      setSupabase({
        url: config.supabase.url,
        anonKey: config.supabase.anonKey,
        appId: config.appId || (typeof location !== 'undefined' ? location.hostname : '') || 'web',
        appVersion: config.appVersion,
      });
    }

    const strip = config.stripQueryParams !== false; // default true

    // Purge old sessions
    void purgeOldSessions();

    // Set up event buffer → IDB + optional beacon
    const stopBuffer = initBuffer(async (events: AnyEvent[]) => {
      await saveEvents(events);
      if (hasEndpoint()) await sendBeaconBatch(events);
      if (hasSupabase()) await sendToSupabase(events, getSessionId());
    });
    _destroyFns.push(stopBuffer);

    // Start capture layers
    const stopClicks = initClickCapture((e) => push(e), strip);
    const stopScroll = initScrollCapture((e) => push(e), strip);
    const stopNav = initNavigationCapture((e) => {
      push(e);
      if (e.method !== 'pageload') refreshScrollCapture();
    }, strip);

    _destroyFns.push(stopClicks, stopScroll, stopNav);

    function togglePanel(): void {
      if (isPanelOpen()) {
        closePanel();
      } else {
        void flush().then(() => openPanel());
      }
    }

    // Keyboard shortcut to toggle panel
    const shortcut = config.shortcut ?? 'Alt+Shift+Y';
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
    _destroyFns.push(() => window.removeEventListener('keydown', onKey, true));

    // Touch-hold gesture to toggle panel (no keyboard on mobile/in-person tests)
    if (config.touchTrigger !== false) {
      const touchTriggerOptions: Partial<TouchTriggerOptions> = {};
      if (config.touchTriggerFingers !== undefined) {
        touchTriggerOptions.fingerCount = config.touchTriggerFingers;
      }
      if (config.touchTriggerHoldMs !== undefined) {
        touchTriggerOptions.holdMs = config.touchTriggerHoldMs;
      }
      const stopTouchTrigger = initTouchTrigger(togglePanel, touchTriggerOptions);
      _destroyFns.push(stopTouchTrigger);
    }

    // Auto-show panel if requested
    if (config.showPanel) {
      // Wait for DOM to be ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => void openPanel(), { once: true });
      } else {
        void openPanel();
      }
    }

    // Flush on page hide via sendBeacon
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });
  },

  /** Manually flush the event buffer. */
  flush(): Promise<void> {
    return flush();
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
    _initialized = false;
  },
};

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

// --- Auto-init from <script> tag ---

function readScriptConfig(): RecapConfig {
  let script: HTMLOrSVGScriptElement | HTMLScriptElement | null = null;

  // Try document.currentScript first
  if (typeof document !== 'undefined' && document.currentScript) {
    script = document.currentScript;
  } else {
    // Fallback: find script by src containing "recap"
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[src]');
    for (const s of Array.from(scripts)) {
      if (s.src.includes('recap')) {
        script = s;
        break;
      }
    }
  }

  if (!script || !('dataset' in script)) return {};

  const el = script as HTMLScriptElement;
  const config: RecapConfig = {};

  if (el.dataset['sessionName']) config.sessionName = el.dataset['sessionName'];
  if (el.dataset['showPanel'] === 'true') config.showPanel = true;
  if (el.dataset['endpoint']) config.endpoint = el.dataset['endpoint'];
  if (el.dataset['supabaseUrl'] && el.dataset['supabaseKey']) {
    config.supabase = { url: el.dataset['supabaseUrl'], anonKey: el.dataset['supabaseKey'] };
  }
  if (el.dataset['appId']) config.appId = el.dataset['appId'];
  if (el.dataset['appVersion']) config.appVersion = el.dataset['appVersion'];
  if (el.dataset['shortcut']) config.shortcut = el.dataset['shortcut'];
  if (el.dataset['stripQueryParams'] === 'false') config.stripQueryParams = false;
  if (el.dataset['touchTrigger'] === 'false') config.touchTrigger = false;
  if (el.dataset['touchTriggerFingers']) {
    config.touchTriggerFingers = parseInt(el.dataset['touchTriggerFingers'], 10);
  }
  if (el.dataset['touchTriggerHoldMs']) {
    config.touchTriggerHoldMs = parseInt(el.dataset['touchTriggerHoldMs'], 10);
  }

  return config;
}

// Auto-initialize when loaded via <script> tag (not when imported as a module)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const autoConfig = readScriptConfig();
  // Self-init — always run when loaded as a script
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Recap.init(autoConfig), { once: true });
  } else {
    Recap.init(autoConfig);
  }
}

// Named exports for ESM / React consumers
export { summarize } from './analysis/summarize.js';
export type * from './types.js';
export default Recap;
