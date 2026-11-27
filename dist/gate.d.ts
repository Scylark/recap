/** Why Recap is or isn't running on this page. See Recap.status(). */
export type RecapStatusReason = 
/** Started and capturing. */
'running'
/** Recap.init() hasn't been called yet. */
 | 'not-started'
/** `?recap=off` was opened in this tab. `?recap=auto` clears it. */
 | 'switched-off'
/** The page is inside an iframe and Recap sends to a dashboard. `allowInFrames: true` allows it. */
 | 'in-frame'
/** The Supabase key is a secret key (service_role or sb_secret_…), so nothing is sent. */
 | 'secret-key'
/** `hosts` is set and this page's hostname isn't in it. `?recap=on` runs here anyway. */
 | 'host-not-listed'
/** This page's path matches `excludePaths`. */
 | 'excluded-path'
/** The browser sends Global Privacy Control and `respectGPC` is on (the default when sending). */
 | 'gpc'
/** The visitor called Recap.optOut() in this browser. */
 | 'opted-out'
/** `requireConsent` is on and Recap.optIn() hasn't been called. */
 | 'consent-needed';
export interface RecapStatus {
    /** Recap is capturing on this page. */
    running: boolean;
    /** This tab's page is being recorded for replay (rrweb is loaded and recording). */
    recording: boolean;
    /** Why: `'running'`, or what stops it, e.g. `'host-not-listed'`. */
    reason: RecapStatusReason;
}
/**
 * A tester's switch for this tab, from `?recap=` in the address and remembered in sessionStorage:
 * `'on'` runs here whatever `hosts` says, with debug logging; `'record'` is the same and also
 * records this tab's page; `'off'` stops Recap in this tab; `?recap=auto` clears the switch.
 */
export type TabSwitch = 'on' | 'record' | 'off' | null;
/** Read `?recap=` from a query string, remember it for the tab, and return the tab's switch. */
export declare function readTabSwitch(search: string): TabSwitch;
/**
 * Whether a hostname is in a `hosts` list. Entries match exactly (`example.com`), or `*.example.com`
 * matches every subdomain of example.com (not example.com itself: list both for both). An empty
 * list matches nothing.
 */
export declare function hostAllowed(hostname: string, hosts: readonly string[]): boolean;
/**
 * Whether a page path matches `excludePaths`. A string is a path prefix (`'/admin'` covers
 * `/admin`, `/admin/users` and `/admin.html`); a RegExp is tested against the path.
 */
export declare function pathExcluded(path: string, excludes: ReadonlyArray<string | RegExp> | undefined): boolean;
/** Whether this page is inside an iframe (a cross-origin parent counts too). */
export declare function inFrame(): boolean;
/** Whether the browser sends Global Privacy Control (navigator.globalPrivacyControl). */
export declare function gpcOn(): boolean;
/**
 * Whether a Supabase key is a secret one that must never be in a web page: a JWT whose payload
 * role is `service_role`, or a new-style `sb_secret_…` key. Returns which, or null for a public
 * (anon or publishable) key.
 */
export declare function secretKeyKind(key: unknown): 'service_role' | 'sb_secret' | null;
/** The console message for a refused secret key. */
export declare function secretKeyMessage(kind: 'service_role' | 'sb_secret'): string;
