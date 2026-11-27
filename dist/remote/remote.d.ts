import type { AnyEvent } from '../types.js';
export declare const REMOTE_SDK_VERSION = "web-0.1.0";
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
    supabase?: {
        url: string;
        anonKey: string;
    };
    /** Or POST batches to any endpoint you run (same body as the mobile SDK's endpoint transport). */
    endpoint?: {
        url: string;
        headers?: Record<string, string>;
        recordingsUrl?: string;
    };
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
export declare class RemoteSink {
    private readonly config;
    private readonly fetchFn;
    private readonly sessionId;
    private readonly startMs;
    private readonly sampled;
    private queue;
    private screen;
    private scrollMax;
    private uploaded;
    private chain;
    private timer;
    private stopFns;
    /** Bytes of keepalive requests still on the way. */
    private keepaliveBytes;
    private domBuffer;
    private domBytes;
    private domSending;
    private stopRecording;
    private recordFn;
    constructor(config: RemoteConfig, fetchFn?: FetchFn);
    /** Start sending. Returns false if this session wasn't sampled. */
    start(): boolean;
    stop(): void;
    getSessionId(): string;
    /** Feed one event from the web tracker's capture layers. */
    handle(event: AnyEvent): void;
    /** A custom event, e.g. track('added_to_basket', { sku: 'A1' }). */
    track(name: string, props?: Record<string, unknown>): void;
    pending(): readonly IngestEvent[];
    private push;
    private batch;
    private target;
    /**
     * POST one batch. It goes as keepalive when it fits in what's left of the browser's keepalive
     * allowance. With `exitOnly` it is only sent as keepalive (the page is closing), and refused otherwise.
     */
    private post;
    /** Send queued events (and recording chunks). Calls run one after another, never overlapping. */
    flush(): Promise<void>;
    private markUploaded;
    private sendQueued;
    /**
     * The page is hidden or closing: send what fits in keepalive requests. A batch already on the way
     * is left to finish (it went as keepalive if it fitted). Recording chunks only follow once the
     * session is stored, because recap_dom drops chunks for sessions it doesn't know yet.
     */
    private flushOnExit;
    private sendDomOnExit;
    private startRecording;
    /** Stop recording this session and drop what's buffered. */
    private endRecording;
    private pushDom;
    /** The oldest buffered events, up to maxBytes. Always at least one, so a big snapshot goes alone. */
    private takeDomChunk;
    private putBackDom;
    private domPayload;
    private sendDom;
    private log;
}
export {};
