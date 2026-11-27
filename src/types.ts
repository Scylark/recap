// Recap UX — shared TypeScript interfaces
// All types are self-contained — no external type dependencies.

import type { RemoteConfig, RemoteRecordingOptions } from './remote/remote.js';
export type { RemoteConfig, RemoteRecordingOptions, RrwebRecord } from './remote/remote.js';
export type { RecapStatus, RecapStatusReason } from './gate.js';

export type EventType = 'click' | 'scroll' | 'navigation' | 'visibility' | 'resize';

export interface Viewport {
  width: number;
  height: number;
}

export interface BaseEvent {
  id?: number; // assigned by IDB auto-increment
  sessionId: string;
  timestamp: number; // performance.now() ms from session start
  type: EventType;
  url: string; // pathname only, no query params
  viewport: Viewport;
}

export interface ClickEvent extends BaseEvent {
  type: 'click';
  pageX: number;
  pageY: number;
  clientX: number;
  clientY: number;
  elementX: number; // 0-1 ratio relative to element bounding box
  elementY: number; // 0-1 ratio relative to element bounding box
  selector: string; // auto-generated CSS selector
  tagName: string;
  label: string | null; // best available human-readable label
  nearestHeading: string | null; // closest preceding h1-h6 text
  pageRegion: PageRegion;
  dataAttributes?: Record<string, string>; // data-ut-* attrs
}

export interface ScrollEvent extends BaseEvent {
  type: 'scroll';
  depth: number; // 0-100 percentage
  maxDepth: number; // highest reached this page load
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

// Page region — 3x3 grid
export type PageRegion =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

// --- Config ---

export interface RecapConfig {
  sessionName?: string;
  showPanel?: boolean;
  endpoint?: string; // optional beacon endpoint
  /**
   * Also send sessions to the Recap tables in your own Supabase project, so they show in the
   * Recap dashboard next to iOS and Android sessions. Use the public anon or publishable key only.
   * Script tag: data-supabase-url and data-supabase-key.
   */
  supabase?: { url: string; anonKey: string };
  /** Name for this site in the dashboard, e.g. "my-shop-web". Default: the page's hostname. Script tag: data-app-id. */
  appId?: string;
  /** Your site's version, shown in the dashboard. Script tag: data-app-version. */
  appVersion?: string;
  /**
   * With `supabase`: record the page for session replay in the dashboard, using rrweb 2.2.2.
   * `true` is enough with the script tag: tabs sampled in load recap-rrweb.min.js from the same
   * folder as recap.min.js. In a module build, pass `{ record }` from `import { record } from
   * 'rrweb'`, or `{ src }` with the address of recap-rrweb.min.js. Every form field is masked, and
   * anything with the privacy marker (`data-recap-private`) is left out. Script tag:
   * data-recordings="true".
   */
  recordings?: boolean | RemoteRecordingOptions;
  /**
   * Log what Recap is doing in the console: why it isn't running (once), what's sent, recording
   * snapshot sizes. `?recap=on` in the address turns it on for one tab. Script tag: data-debug="true".
   */
  debug?: boolean;
  /**
   * The researcher panel and the shortcut and touch-hold that open it. Default: on while data stays
   * in the browser, off once sessions go to a dashboard (`supabase`, `remote` or `connect()`), so
   * visitors to a live site never see it. `true` turns it on there too, `false` turns it off
   * everywhere. Script tag: data-panel="true" or "false".
   */
  panel?: boolean;
  /**
   * Only run on these hostnames: exact (`'example.com'`), or `'*.example.com'` for its subdomains
   * (list both for both). Anywhere else (localhost, preview deploys) Recap does nothing, unless the
   * address has `?recap=on`. Default: everywhere. Script tag: data-hosts="example.com,*.example.com".
   */
  hosts?: string[];
  /**
   * Pages where nothing runs: a string is a path prefix (`'/admin'` also covers `/admin/users` and
   * `/admin.html`), a RegExp is tested against the path. In a single-page app, going to such a page
   * stops capture there and turns page recording off until the next full page load. Script tag:
   * data-exclude-paths="/account,/admin".
   */
  excludePaths?: Array<string | RegExp>;
  /**
   * Respect Global Privacy Control: when the browser sends it (`navigator.globalPrivacyControl`),
   * nothing is captured. Default: true once sessions go to a dashboard, false while data stays in
   * the browser. Script tag: data-respect-gpc="false".
   */
  respectGPC?: boolean;
  /**
   * Run inside an iframe. Default: false once sessions go to a dashboard (nothing runs in a frame,
   * so a page embedded elsewhere isn't counted twice or under someone else's site), true while data
   * stays in the browser. Script tag: data-allow-in-frames.
   */
  allowInFrames?: boolean;
  /** Keyboard shortcut for the panel, e.g. "ctrl+shift+y", or false for none. Default "alt+shift+y". */
  shortcut?: string | false;
  stripQueryParams?: boolean; // default true
  /**
   * Where tap labels come from. `'text'`: also the tapped element's visible text. `'attributes'`:
   * only aria-label, aria-labelledby, title, alt and placeholder. `'none'`: only your own
   * data-ut-label. data-ut-label is always used, and inside the mask marker (`data-recap-mask`,
   * `.recap-mask`) it is the only source.
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

// --- Session summary (AI export) ---

export interface SessionSummary {
  meta: {
    sessionId: string;
    sessionName?: string;
    startTime: string; // ISO 8601
    endTime: string;
    duration: number; // seconds
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
  timestamp: number; // seconds from session start
  action: string; // human-readable description
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
  totalTimeOnPage: number; // seconds
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
