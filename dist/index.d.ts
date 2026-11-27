import type { RecapConfig } from './types.js';
import { type RemoteConfig } from './remote/remote.js';
import { type RecapStatus } from './gate.js';
export declare const Recap: {
    /**
     * Start Recap, or change its settings. The first call starts capturing; later calls change only
     * the settings they pass (panel, labels, screen names, consent, dashboard connection). On a page
     * the gate stops (see status()), nothing starts.
     */
    init(config?: RecapConfig): void;
    /**
     * Send this session to your Recap dashboard as well (Supabase or an endpoint). Call init() first.
     * Safe to call more than once; only the first settings are used. With `requireConsent`, the
     * connection starts once the visitor opts in. The live-site defaults apply from here on: the
     * panel is off unless `panel: true`, labels come from attributes, GPC is respected and nothing
     * runs inside an iframe.
     */
    connect(config: RemoteConfig): void;
    /**
     * The visitor agreed to analytics: start recording (and sending, if connected). Remembered in
     * this browser. Needed only with `requireConsent`, or after optOut().
     */
    optIn(): void;
    /**
     * The visitor said no: stop recording and sending, and delete everything not yet sent.
     * Remembered in this browser until optIn().
     */
    optOut(): void;
    /** Whether Recap is recording now: started, and not stopped by the gate, consent or opt-out. */
    isRecording(): boolean;
    /**
     * Whether Recap is running on this page and, if not, why: `{ running, recording, reason }`.
     * `recording` is true while this tab's page is recorded for replay. `reason` is `'running'`, or
     * what stops it: `'not-started'`, `'host-not-listed'`, `'excluded-path'`, `'gpc'`, `'opted-out'`,
     * `'consent-needed'`, `'in-frame'`, `'secret-key'` or `'switched-off'`.
     */
    status(): RecapStatus;
    /** Record a custom event, e.g. Recap.track('added_to_basket', { sku: 'A1' }). Sent only when connected. */
    track(name: string, props?: Record<string, unknown>): void;
    /** Manually flush the event buffer. */
    flush(): Promise<void>;
    /** Get the current session ID. */
    getSessionId(): string;
    /** Open the researcher panel programmatically. */
    openPanel(): Promise<void>;
    /** Close the researcher panel. */
    closePanel(): void;
    /** Export current session as JSON. */
    exportJSON(): void;
    /** Export current session as CSV. */
    exportCSV(): void;
    /** Export AI summary. */
    exportAI(): void;
    /** Tear down all listeners and clean up. */
    destroy(): void;
};
/**
 * Settings read from the script tag's data-* attributes (script-tag build only). init() puts
 * anything it is given on top of these.
 * @internal
 */
export declare function setScriptDefaults(config: RecapConfig): void;
export { summarize } from './analysis/summarize.js';
export type * from './types.js';
export default Recap;
