import type { AnyEvent } from '../types.js';
/**
 * Delete every event kept in this browser: closes Recap's own connection first (an open
 * connection would block the delete) and removes the whole database. Used when the visitor opts out.
 */
export declare function deleteLocalData(): Promise<void>;
export declare function saveEvents(events: AnyEvent[]): Promise<void>;
export declare function getSessionEvents(sessionId: string): Promise<AnyEvent[]>;
export declare function getAllSessions(): Promise<Array<{
    sessionId: string;
    sessionName?: string;
    startTime: number;
    eventCount: number;
}>>;
export declare function clearSession(sessionId: string): Promise<void>;
export declare function clearAllSessions(): Promise<void>;
/** Remove sessions older than RETENTION_DAYS. Called on init. */
export declare function purgeOldSessions(): Promise<void>;
export declare function isUsingMemoryFallback(): boolean;
