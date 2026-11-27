import type { AnyEvent } from '../types.js';
export declare const WEB_SDK_VERSION = "web-1.2.0";
export interface SupabaseTarget {
    url: string;
    anonKey: string;
    appId: string;
    appVersion?: string | undefined;
}
interface IngestEvent {
    type: 'screen' | 'tap' | 'scroll' | 'app_state';
    t: number;
    at: string;
    screen: string | null;
    data: Record<string, unknown>;
}
export declare function setSupabase(target: SupabaseTarget): void;
export declare function hasSupabase(): boolean;
/** Wall clock time the session started. Kept in sessionStorage so it survives page loads, like the session id. */
export declare function sessionStartMs(now?: number): number;
/** A short, non-identifying device label, e.g. "Chrome on Mac". */
export declare function describeBrowser(ua: string): string;
/**
 * Turn web events into the shape recap_ingest() expects.
 * `timeOrigin` is the wall clock time performance.now() counts from (performance.timeOrigin).
 */
export declare function toIngestEvents(events: AnyEvent[], timeOrigin: number, startMs: number): IngestEvent[];
export declare function buildBatch(events: AnyEvent[], ctx: {
    appId: string;
    appVersion?: string | undefined;
    sessionId: string;
    startMs: number;
    timeOrigin: number;
}): Record<string, unknown>;
/**
 * Send events, plus any left over from a failed send. keepalive lets it finish when the page is closing.
 * Failures are kept in memory (up to 1 000 events) and retried with the next batch, so the local
 * copy in IndexedDB is never written twice.
 */
export declare function sendToSupabase(events: AnyEvent[], sessionId: string): Promise<void>;
/** For tests. */
export declare function pendingCount(): number;
export {};
