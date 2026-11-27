import type { RecapConfig } from './types.js';
import { type RemoteConfig } from './remote/remote.js';
export declare const Recap: {
    /**
     * Start Recap, or change its settings. The first call starts capturing; later calls change only
     * the settings they pass (panel, labels, screen names, consent, dashboard connection).
     */
    init(config?: RecapConfig): void;
    /**
     * Send this session to your Recap dashboard as well (Supabase or an endpoint). Call init() first.
     * Safe to call more than once; only the first settings are used. With `requireConsent`, the
     * connection starts once the visitor opts in.
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
    /** Whether Recap is recording now: started, and not waiting for consent or opted out. */
    isRecording(): boolean;
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
