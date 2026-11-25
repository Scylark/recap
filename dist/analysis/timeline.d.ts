import type { AnyEvent } from '../types.js';
export interface PageVisit {
    pagePath: string;
    arrivalTime: number;
    duration: number | null;
    visitNumber: number;
    isRevisit: boolean;
    tags: PageVisitTag[];
}
export type PageVisitTag = 'backtrack' | 'first task' | 'abandoned' | 'end of session' | 'long pause' | 'brief visit';
/**
 * Derive a chronological PageVisit list from a session's raw events.
 *
 * @param events      All events for the session, in any order.
 * @param isCurrentSession  True when the session is still live — the last visit
 *                    gets duration=null and no end-of-session / abandoned tag.
 */
export declare function generateTimeline(events: AnyEvent[], isCurrentSession?: boolean): PageVisit[];
/**
 * Absolute time window (same clock as event timestamps) for one visit.
 * Visit offsets are seconds from the session's first event, so the session start
 * is added back. The last visit is open-ended so its final clicks are included.
 */
export declare function visitWindowMs(visit: PageVisit, sessionStartMs: number, isLastVisit: boolean): {
    visitStartMs: number;
    visitEndMs: number | null;
};
/**
 * Keep only the events that belong to one visit: same page, inside the visit window.
 * Used so the visit view's stats and scroll depth match the heatmap's clicks.
 */
export declare function eventsInVisit(events: AnyEvent[], visit: {
    pagePath: string;
    visitStartMs: number;
    visitEndMs: number | null;
}): AnyEvent[];
