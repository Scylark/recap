/**
 * Preparing a recorded web page (an rrweb full snapshot) to be drawn at its full length, for the
 * heatmap: the whole page in one tall frame rather than one window that scrolls.
 *
 * A tall frame changes what the page's CSS means by the window's height: `min-height: 100vh` would
 * stretch to the length of the page. So window-height units are turned into the pixels they were in
 * the visitor's window before the page is built. Pure: the snapshot is copied, never changed.
 */

import type { DomEvent } from './data';

interface SerializedNode {
  type: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SerializedNode[];
  textContent?: string;
  isStyle?: boolean;
  [key: string]: unknown;
}

const VIEWPORT_UNITS = /(-?(?:\d+\.?\d*|\.\d+))(dvh|svh|lvh|vh|vmax|vmin)\b/g;

/** CSS with vh (and dvh, svh, lvh, vmax, vmin) written as the pixels they were in this window. */
export function fixViewportUnits(css: string, width: number, height: number): string {
  if (!css || !/v(?:h|max|min)\b/.test(css)) return css;
  return css.replace(VIEWPORT_UNITS, (_m, n: string, unit: string) => {
    const base = unit === 'vmax' ? Math.max(width, height) : unit === 'vmin' ? Math.min(width, height) : height;
    const px = (Number(n) * base) / 100;
    return `${Math.round(px * 100) / 100}px`;
  });
}

function fixNode(node: SerializedNode, width: number, height: number): SerializedNode {
  const out: SerializedNode = { ...node };
  if (node.attributes) {
    const attrs: Record<string, unknown> = { ...node.attributes };
    for (const k of ['style', '_cssText']) if (typeof attrs[k] === 'string') attrs[k] = fixViewportUnits(attrs[k] as string, width, height);
    out.attributes = attrs;
  }
  if (typeof node.textContent === 'string' && (node.isStyle || /^style$/i.test(String(node.tagName ?? ''))))
    out.textContent = fixViewportUnits(node.textContent, width, height);
  if (node.childNodes) {
    const parentIsStyle = /^style$/i.test(String(node.tagName ?? ''));
    out.childNodes = node.childNodes.map((c) =>
      parentIsStyle && c.type === 3 && typeof c.textContent === 'string'
        ? { ...c, textContent: fixViewportUnits(c.textContent, width, height) }
        : fixNode(c, width, height),
    );
  }
  return out;
}

/**
 * The events to build a page from, ready for a tall frame: the meta event (window size) and the full
 * snapshot with its window-height units fixed, and no scroll offset.
 */
export function tallPageEvents(events: DomEvent[], width: number, height: number): DomEvent[] {
  return events.map((e) => {
    if (e.type !== 2) return e;
    const data = (e.data ?? {}) as { node?: SerializedNode; initialOffset?: unknown };
    if (!data.node) return e;
    return { ...e, data: { ...data, node: fixNode(data.node, width, height), initialOffset: { top: 0, left: 0 } } };
  });
}

/** A short name for an element on the drawn page: its label, else its own words, else its tag. */
export function elementName(el: Element): string {
  const attr = (n: string) => el.getAttribute(n)?.trim() || '';
  const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const name = attr('data-ut-label') || attr('aria-label') || attr('title') || attr('alt') || words;
  const tag = el.tagName.toLowerCase();
  if (!name) return tag === 'a' ? 'Link' : tag === 'button' ? 'Button' : `<${tag}>`;
  return name.length > 48 ? `${name.slice(0, 47)}…` : name;
}
