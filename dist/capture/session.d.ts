/**
 * Decide when the session id may be kept in sessionStorage. Until `mayKeep()` says yes (with
 * requireConsent, before Recap.optIn(); after Recap.optOut()), getSessionId() returns an id for
 * this page only and writes nothing.
 * @internal
 */
export declare function setSessionKeeping(mayKeep: (() => boolean) | null): void;
export declare function getSessionId(): string;
/**
 * Forget this tab's session id (the visitor opted out): the next getSessionId() makes a new one,
 * so a later opt-in starts a new session instead of continuing the old one.
 */
export declare function resetSessionId(): void;
export declare function setSessionName(name: string): void;
export declare function getSessionName(): string | null;
export declare function getTimestamp(): number;
export declare function getSessionStart(): number;
