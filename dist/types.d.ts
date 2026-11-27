import type { RemoteConfig, RemoteRecordingOptions } from './remote/remote.js';
export type { RemoteConfig, RemoteRecordingOptions, RrwebRecord } from './remote/remote.js';
export type EventType = 'click' | 'scroll' | 'navigation' | 'visibility' | 'resize';
export interface Viewport {
    width: number;
    height: number;
}
export interface BaseEvent {
    id?: number;
    sessionId: string;
    timestamp: number;
    type: EventType;
    url: string;
    viewport: Viewport;
}
export interface ClickEvent extends BaseEvent {
    type: 'click';
    pageX: number;
    pageY: number;
    clientX: number;
    clientY: number;
    elementX: number;
    elementY: number;
    selector: string;
    tagName: string;
    label: string | null;
    nearestHeading: string | null;
    pageRegion: PageRegion;
    dataAttributes?: Record<string, string>;
}
export interface ScrollEvent extends BaseEvent {
    type: 'scroll';
    depth: number;
    maxDepth: number;
}
export interface NavigationEvent extends BaseEvent {
    type: 'navigation';
    from: string;
    to: string;
    method: 'pushState' | 'replaceState' | 'popstate' | 'hashchange' | 'pageload';
}
export interface VisibilityEvent extends BaseEvent {
    type: 'visibility';
    state: 'hidden' | 'visible';
}
export interface ResizeEvent extends BaseEvent {
    type: 'resize';
    viewport: Viewport;
}
export type AnyEvent = ClickEvent | ScrollEvent | NavigationEvent | VisibilityEvent | ResizeEvent;
export type PageRegion = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export interface RecapConfig {
    sessionName?: string;
    showPanel?: boolean;
    endpoint?: string;
    /**
     * Also send sessions to the Recap tables in your own Supabase project, so they show in the
     * Recap dashboard next to iOS and Android sessions. Use the public anon or publishable key only.
     * Script tag: data-supabase-url and data-supabase-key.
     */
    supabase?: {
        url: string;
        anonKey: string;
    };
    /** Name for this site in the dashboard, e.g. "my-shop-web". Default: the page's hostname. Script tag: data-app-id. */
    appId?: string;
    /** Your site's version, shown in the dashboard. Script tag: data-app-version. */
    appVersion?: string;
    /**
     * With `supabase`: record the page for session replay in the dashboard, using rrweb. Pass
     * `{ record }` from `import { record } from 'rrweb'`, or load rrweb's script first and use `true`.
     * Every form field is masked; anything with class "recap-private" or data-ut-no-track is left out.
     * Script tag: data-recordings="true".
     */
    recordings?: boolean | RemoteRecordingOptions;
    /** Log what's sent to the dashboard in the console. */
    debug?: boolean;
    /**
     * The researcher panel and the shortcut and touch-hold that open it. `false` turns all three off
     * (use it on live sites, so visitors never see it). Default true. Script tag: data-panel="false".
     */
    panel?: boolean;
    /** Keyboard shortcut for the panel, e.g. "ctrl+shift+y", or false for none. Default "alt+shift+y". */
    shortcut?: string | false;
    stripQueryParams?: boolean;
    /**
     * Where tap labels come from. `'text'`: also the tapped element's visible text. `'attributes'`:
     * only aria-label, aria-labelledby, title, alt and placeholder. `'none'`: only your own
     * data-ut-label. data-ut-label is always used, and inside `.ut-mask` it is the only source.
     * Default: `'text'` while data stays in the browser, `'attributes'` once sessions go to a
     * dashboard (`supabase`, `remote` or `connect()`). Script tag: data-labels.
     */
    labels?: 'none' | 'attributes' | 'text';
    /**
     * Name screens your way: gets each page's path (e.g. "/app/dashboard.html") and returns the name
     * to count it under (e.g. "/app/dashboard"). Return the path, or nothing, to keep it as it is.
     * Used for page views, taps, scrolls and the dashboard's screen names. Set it in the first
     * init() call (with the script tag, use data-auto-init="false" and call init() yourself).
     */
    screenName?: (path: string) => string | null | undefined;
    /**
     * Record and send nothing until Recap.optIn() is called. The choice is remembered in this
     * browser. Recap.optOut() works with or without this. Default false. Script tag:
     * data-require-consent="true".
     */
    requireConsent?: boolean;
    /** Enable the touch-hold gesture that opens/closes the panel on touch devices. Default: true. */
    touchTrigger?: boolean;
    /** Number of simultaneous touch points required to trigger the panel. Default: 3. */
    touchTriggerFingers?: number;
    /** Milliseconds the touch points must be held before the panel toggles. Default: 1500. */
    touchTriggerHoldMs?: number;
    /** Advanced: full dashboard settings (sampling, flush interval, your own endpoint). Overrides `supabase`. */
    remote?: RemoteConfig;
}
export interface SessionSummary {
    meta: {
        sessionId: string;
        sessionName?: string;
        startTime: string;
        endTime: string;
        duration: number;
        viewport: Viewport;
        pagesVisited: number;
        totalClicks: number;
        totalScrollEvents: number;
    };
    timeline: TimelineEntry[];
    pages: PageSummary[];
    patterns: {
        mostClickedElements: ElementInteraction[];
        unclickedRegions: string[];
        averageTimeToFirstClick: number;
        navigationPath: string[];
        backtracking: BacktrackEvent[];
        rapidClicks: RapidClickCluster[];
        scrollDropoff: ScrollDropoff[];
    };
    promptTemplate: string;
}
export interface TimelineEntry {
    timestamp: number;
    action: string;
    type: 'click' | 'navigate' | 'scroll_milestone' | 'pause' | 'rapid_click';
    page: string;
    element?: {
        selector: string;
        tagName: string;
        role?: string;
        label: string | null;
        nearestHeading: string | null;
        pageRegion?: PageRegion;
    };
    context?: string;
}
export interface PageSummary {
    url: string;
    visits: number;
    totalTimeOnPage: number;
    timeToFirstClick: number | null;
    maxScrollDepth: number;
    scrollDropoffPoint: number;
    clicks: {
        total: number;
        byRegion: Partial<Record<PageRegion, number>>;
        byElement: ElementInteraction[];
    };
}
export interface ElementInteraction {
    selector: string;
    tagName: string;
    label: string | null;
    clickCount: number;
    averageTimeBetweenClicks?: number;
    pageRegion: PageRegion;
}
export interface BacktrackEvent {
    from: string;
    to: string;
    timestamp: number;
    timeOnPageBeforeBack: number;
}
export interface RapidClickCluster {
    selector: string;
    label: string | null;
    clickCount: number;
    durationMs: number;
    timestamp: number;
    page: string;
}
export interface ScrollDropoff {
    page: string;
    depth: number;
}
