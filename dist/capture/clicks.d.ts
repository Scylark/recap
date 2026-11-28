import type { ClickEvent, PageRegion, Viewport } from '../types.js';
/**
 * Whether an element id may go in a selector. Ids with an @ or a run of three or more digits are
 * often personal details or record numbers (#user-jane@x.com, #order-12345), which selectors
 * would send to the dashboard; those elements are described by tag and position instead.
 */
export declare function usableId(id: string): boolean;
/**
 * Generate a human-readable, stable CSS selector for a DOM element.
 * Strategy (per spec):
 *  1. #id → return immediately (only ids that pass usableId)
 *  2. data-ut-label → [data-ut-label="value"]
 *  3. Walk up to body, building a path of tag + class/nth-of-type segments
 *  4. Stop at an ancestor with a usable id → use #id as root
 *  5. Cap at 5 levels
 */
export declare function generateSelector(el: Element): string;
export declare function getPageRegion(clientX: number, clientY: number, viewport: Viewport): PageRegion;
export declare function detectRapidClick(selector: string, clientX: number, clientY: number, now: number): {
    isRapid: boolean;
    count: number;
    duration: number;
};
type ClickHandler = (event: ClickEvent) => void;
export declare function pauseClickCapture(): void;
export declare function resumeClickCapture(): void;
export declare function initClickCapture(handler: ClickHandler, stripQuery?: boolean): () => void;
export {};
