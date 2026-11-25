/*
 * Heatmap renderer — adapted from simpleheat by Vladimir Agafonkin
 * Original: https://github.com/mourner/simpleheat
 * License: BSD-2-Clause
 *
 * Copyright (c) 2015, Vladimir Agafonkin
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 */

import type { ClickEvent } from '../types.js';

export interface HeatmapFilter {
  pagePath: string;
  visitStartMs: number;
  visitEndMs: number | null; // null = open-ended (last visit still in progress)
  label: string;             // e.g. "visit 2 of 3" — shown in the filter bar
}

const DEFAULT_RADIUS = 25;
const DEFAULT_BLUR = 15;
const DEFAULT_OPACITY = 0.65;

// Colour ramp, cool → hot: blue (fewest clicks) → yellow → red (most clicks on this page).
// Blue holds across the lower part of the ramp, so a single click stays blue
// even with a four-click reference.
const DEFAULT_GRADIENT: Record<number, string> = {
  0: 'blue',
  0.3: 'blue',
  0.6: 'yellow',
  1: 'red',
};

// Accumulated density (out of 255) at which the blur halo starts to fade in.
// Fading across a band, rather than cutting off hard, keeps the edge smooth.
const EDGE_FADE_START = 2;
const EDGE_FADE_END = 12;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
// Drawn pixels scale their opacity between these bounds (0–1): the coolest
// spots are fairly faint, and the hottest spot tops out below fully opaque so
// red does not overpower the page.
const MIN_OUTPUT_OPACITY = 0.4;
const MAX_OUTPUT_OPACITY = 0.8;

// Each click is drawn at this alpha, so overlapping clicks build up density.
const CLICK_ALPHA = 0.05;
// Scaling never uses fewer clicks than this as its "hottest" reference. Without
// it, a page with one or two clicks makes them both the maximum, so they show
// as red. With it, sparse clicks sit at the cool (blue) end of the ramp, and
// only real clusters reach red.
const REFERENCE_CLICKS = 4;
const MIN_REFERENCE_DENSITY = 255 * (1 - Math.pow(1 - CLICK_ALPHA, REFERENCE_CLICKS));

let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;
let _circle: HTMLCanvasElement | null = null;
let _colorGradient: Uint8ClampedArray | null = null;
let _radius = DEFAULT_RADIUS;
let _blur = DEFAULT_BLUR;
let _clicks: ClickEvent[] = [];
let _filter: HeatmapFilter | null = null;
let _scrollScheduled = false;

function handleScroll(): void {
  if (_canvas?.style.display === 'none') return;
  if (_scrollScheduled) return;
  _scrollScheduled = true;
  requestAnimationFrame(() => {
    _scrollScheduled = false;
    // Keep the active visit filter; a scroll must not widen the view to every visit.
    renderHeatmap(_clicks, _filter ?? undefined);
  });
}

function createCircle(radius: number, blur: number): HTMLCanvasElement {
  const r = radius + blur;
  const d = 2 * r;
  const c = document.createElement('canvas');
  c.width = d;
  c.height = d;
  const cx = c.getContext('2d')!;
  const grad = cx.createRadialGradient(r, r, blur, r, r, r);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = grad;
  cx.fillRect(0, 0, d, d);
  return c;
}

function createColorGradient(stops: Record<number, string>): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1;
  const cx = c.getContext('2d')!;
  const grad = cx.createLinearGradient(0, 0, 256, 0);
  for (const [stop, color] of Object.entries(stops)) {
    grad.addColorStop(Number(stop), color);
  }
  cx.fillStyle = grad;
  cx.fillRect(0, 0, 256, 1);
  return cx.getImageData(0, 0, 256, 1).data;
}

// Scales density relative to the busiest point on the canvas, so the hottest
// spot is red and everything else is scaled linearly against it. The reference
// is never lower than MIN_REFERENCE_DENSITY, so a few clicks stay blue.
function colorize(pixels: ImageData, gradient: Uint8ClampedArray): void {
  const data = pixels.data;

  let maxDensity = 0;
  for (let i = 3, len = data.length; i < len; i += 4) {
    if (data[i]! > maxDensity) maxDensity = data[i]!;
  }
  if (maxDensity === 0) return;
  const reference = Math.max(maxDensity, MIN_REFERENCE_DENSITY);

  for (let i = 0, len = data.length; i < len; i += 4) {
    const density = data[i + 3]!;
    if (density < EDGE_FADE_START) {
      data[i + 3] = 0;
      continue;
    }
    const edge = smoothstep(EDGE_FADE_START, EDGE_FADE_END, density);
    const t = Math.min(1, density / reference); // 0..1, 1 = hottest point
    const idx = Math.round(t * 255) * 4;
    data[i] = gradient[idx]!;
    data[i + 1] = gradient[idx + 1]!;
    data[i + 2] = gradient[idx + 2]!;
    data[i + 3] = Math.round(
      255 * edge * (MIN_OUTPUT_OPACITY + (MAX_OUTPUT_OPACITY - MIN_OUTPUT_OPACITY) * t)
    );
  }
}

export function initHeatmapCanvas(): HTMLCanvasElement {
  if (_canvas) return _canvas;

  _canvas = document.createElement('canvas');
  _canvas.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    opacity: ${DEFAULT_OPACITY};
    z-index: 9999;
    display: none;
  `;
  _canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_canvas);
  window.addEventListener('scroll', handleScroll, { passive: true });

  _ctx = _canvas.getContext('2d')!;
  _circle = createCircle(DEFAULT_RADIUS, DEFAULT_BLUR);
  _colorGradient = createColorGradient(DEFAULT_GRADIENT);
  _radius = DEFAULT_RADIUS;
  _blur = DEFAULT_BLUR;

  return _canvas;
}

function resizeCanvas(): void {
  if (!_canvas) return;
  _canvas.width = window.innerWidth;
  _canvas.height = window.innerHeight;
}

export function renderHeatmap(clicks: ClickEvent[], filter?: HeatmapFilter): void {
  if (!_canvas || !_ctx) return;

  _clicks = clicks;
  _filter = filter ?? null;
  resizeCanvas();
  // Nothing to draw on a zero-size canvas (e.g. panel opened before the page
  // has laid out) — getImageData throws IndexSizeError on a 0 dimension.
  if (_canvas.width === 0 || _canvas.height === 0) return;
  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

  // Apply filter: a specific visit's time range if set, otherwise scope to current page
  const currentPage = location.pathname;
  const visible = _filter
    ? clicks.filter(
        (c) =>
          c.url === _filter!.pagePath &&
          c.timestamp >= _filter!.visitStartMs &&
          (_filter!.visitEndMs === null || c.timestamp < _filter!.visitEndMs)
      )
    : clicks.filter((c) => c.url === currentPage);

  if (visible.length === 0) return;

  // Use pageX/pageY (document-relative) adjusted by current scroll offset
  // so dots stay aligned with page content as the user scrolls.
  _ctx.globalAlpha = CLICK_ALPHA;
  for (const click of visible) {
    const r = _radius + _blur;
    _ctx.drawImage(_circle!, click.pageX - window.scrollX - r, click.pageY - window.scrollY - r);
  }

  // Colorize
  const imageData = _ctx.getImageData(0, 0, _canvas.width, _canvas.height);
  colorize(imageData, _colorGradient!);
  _ctx.putImageData(imageData, 0, 0);
}

export function showHeatmap(): void {
  if (_canvas) _canvas.style.display = 'block';
}

export function hideHeatmap(): void {
  if (_canvas) _canvas.style.display = 'none';
}

export function isHeatmapVisible(): boolean {
  return _canvas?.style.display !== 'none';
}

export function getHeatmapFilter(): HeatmapFilter | null {
  return _filter;
}

export function getHeatmapDataURL(): string | null {
  if (!_canvas) return null;
  return _canvas.toDataURL('image/png');
}

export function destroyHeatmap(): void {
  if (_canvas) {
    window.removeEventListener('scroll', handleScroll);
    _canvas.parentElement?.removeChild(_canvas);
    _canvas = null;
    _ctx = null;
  }
  _filter = null;
}
