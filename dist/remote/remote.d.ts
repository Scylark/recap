import type { AnyEvent } from '../types.js';
export declare const REMOTE_SDK_VERSION = "web-0.3.0";
/** The rrweb maskTextSelector for a recordings.maskText setting. The mask marker is always masked. */
export declare function maskTextSelectorFor(maskText: boolean | string | undefined): string;
/** Canvas frames per second for a recordings.canvas setting: 2 for true, the number given, or 0 (off). */
export declare function canvasFps(canvas: boolean | number | undefined): number;
/**
 * Where to load recap-rrweb.min.js from when recordings.src isn't set. The script-tag build sets it
 * to the folder recap.min.js was loaded from.
 * @internal
 */
export declare function setDefaultRrwebSrc(src: string | null): void;
/**
 * Add a <script> for `src` once per address, resolving when it has run. Rejects (never throws) if
 * it can't load: offline, blocked by a Content-Security-Policy, the wrong address or the wrong
 * integrity hash. A failed address can be tried again by a later call.
 */
export declare function loadScript(src: string, integrity?: string): Promise<void>;
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
    /**
     * rrweb's record function (`import { record } from 'rrweb'`, version 2.2.2). Without it Recap
     * uses `window.rrweb.record` if rrweb is on the page, or else loads recap-rrweb.min.js from `src`.
     */
    record?: RrwebRecord;
    /**
     * Address of recap-rrweb.min.js (rrweb's recorder as a plain script), loaded only for tabs sampled
     * in for recordings and only when `record` isn't given. The script-tag build defaults to the folder
     * recap.min.js came from; module builds need this or `record`. Script tag: data-recordings-src.
     */
    src?: string;
    /** Subresource integrity hash for `src`, e.g. "sha384-…". Script tag: data-recordings-integrity. */
    integrity?: string;
    /** Share of tabs to record, 0 to 1. Default 1. Script tag: data-record-sample. */
    sampleRate?: number;
    /**
     * Record <canvas> drawings (charts, for example) as pictures: `true` for 2 frames a second, or a
     * number of frames a second. Unchanged frames aren't sent again. Default off. Script tag:
     * data-record-canvas.
     */
    canvas?: boolean | number;
    /** Extra CSS selector for parts of the page never recorded. The privacy marker (`data-recap-private`, `.recap-private`) always is. */
    blockSelector?: string;
    /**
     * Text to replace with `*` in recordings, keeping the layout: `true` for all text on the page, or
     * a CSS selector for the parts to mask (and everything inside them). Text inside the mask marker
     * (`data-recap-mask`, `.recap-mask`) is always masked. Form fields are always masked, whatever
     * this says. Default: only the mask marker.
     */
    maskText?: boolean | string;
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
    /**
     * Remove the query string from the page address sent with recordings (the hash is always
     * removed). Default true; the web tracker passes on its own `stripQueryParams`.
     */
    stripQueryParams?: boolean;
    /** Log what Recap is doing to the console. */
    debug?: boolean;
}
/** How the web tracker starts a sink in a tab with a test switch (?recap=on or ?recap=record). */
export interface SinkOptions {
    /** Send this session whatever `sampleRate` says. */
    sampleIn?: boolean;
    /** Record this tab's page whatever `recordings.sampleRate` says. */
    recordIn?: boolean;
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
    /** Started and not stopped: a recorder that finishes loading after stop() must not start. */
    private active;
    /** Recording is off for the rest of this page load (it went to a path in excludePaths). */
    private recordingBlocked;
    private readonly opts;
    constructor(config: RemoteConfig, fetchFn?: FetchFn, opts?: SinkOptions);
    /** Start sending. Returns false if this session wasn't sampled, or the key is a secret one. */
    start(): boolean;
    stop(): void;
    /**
     * The visitor opted out: stop at once and delete everything not yet sent (events and
     * recording). The browser's random id is forgotten too, so a later opt-in can't be linked to
     * earlier visits.
     */
    discard(): void;
    getSessionId(): string;
    /** Whether this tab's page is being recorded now. */
    isRecordingPage(): boolean;
    /**
     * Stop recording the page for the rest of this page load, and don't start (or finish loading) a
     * recorder. What was recorded before is still sent. Used when a single-page app goes to a path
     * in excludePaths: the private page can stay on screen for a moment after the address changes,
     * so a fresh snapshot taken when it leaves could still show it.
     */
    blockRecording(reason: string): void;
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
    private beginRecording;
    /** Stop recording this session and drop what's buffered. */
    private endRecording;
    private pushDom;
    /**
     * An rrweb event as it may be stored. Meta events carry the page address: keep its origin and
     * path (the Replayer needs an absolute address to load relative images and stylesheets) and drop
     * the hash and, unless stripQueryParams is false, the query string, which can hold ids and
     * tokens. Same rules as the addresses of page views, but without the screenName hook.
     */
    private cleanDom;
    /** The oldest buffered events, up to maxBytes. Always at least one, so a big snapshot goes alone. */
    private takeDomChunk;
    private putBackDom;
    private domPayload;
    private sendDom;
    private log;
}
export {};
