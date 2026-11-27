import type { RecapConfig } from './types.js';
import { type RemoteConfig } from './remote/remote.js';
export declare const Recap: {
    /**
     * Initialize the tracker with optional config.
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    init(config?: RecapConfig): void;
    /**
     * Send this session to your Recap dashboard as well (Supabase or an endpoint). Safe to call more
     * than once; only the first call connects.
     */
    connect(config: RemoteConfig): void;
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
export { summarize } from './analysis/summarize.js';
export type * from './types.js';
export default Recap;
