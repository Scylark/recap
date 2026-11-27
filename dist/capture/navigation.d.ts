import type { NavigationEvent } from '../types.js';
type NavHandler = (event: NavigationEvent) => void;
export declare function pauseNavigationCapture(): void;
export declare function resumeNavigationCapture(): void;
/**
 * Report the page the visitor is on now as a page load, e.g. once they opt in, so the session
 * starts with the screen they were on.
 */
export declare function emitCurrentPage(): void;
export declare function initNavigationCapture(handler: NavHandler, stripQuery?: boolean): () => void;
export {};
