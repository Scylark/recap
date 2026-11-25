// Navigation flow diagram — exports an SVG of the page sequence.
// Pages sit left to right in order of first visit. Forward moves are blue, and
// backtracks are orange dashed arcs. Each route carries the step numbers it was used on.

import type { NavigationEvent } from '../types.js';
import { buildFilename, downloadText } from '../storage/export.js';

// Black and white, with blue outlines and forward journeys, and orange for backtracks.
const COLOUR = {
  background: '#09090b',
  boxFill: '#18181b',
  boxStroke: '#4299e1',
  text: '#fafafa',
  muted: '#a1a1aa',
  forward: '#4299e1',
  back: '#f6ad55',
  badgeText: '#09090b',
};

const BOX_W = 180;
const BOX_H = 56;
const GAP_X = 70;
const MIN_WIDTH = 420;
const TITLE_CLEARANCE = 75; // space kept free above the boxes for the title
const ARC_BASE = 45; // arc depth for a one-column jump
const ARC_STEP = 18; // extra depth per additional column jumped
const BOTTOM_MARGIN = 96; // room for the legend and footer below the boxes

interface PageNode {
  url: string;
  visits: number;
  totalTime: number; // seconds
}

interface Route {
  from: string;
  to: string;
  steps: number[]; // step numbers (1-based, in order) on which this move happened
}

function buildFlowGraph(navEvents: NavigationEvent[]): { nodes: PageNode[]; routes: Route[] } {
  const nodeMap = new Map<string, PageNode>();
  const routeMap = new Map<string, Route>();
  let stepCount = 0;

  for (let i = 0; i < navEvents.length; i++) {
    const nav = navEvents[i]!;
    if (nav.to && !nodeMap.has(nav.to)) {
      nodeMap.set(nav.to, { url: nav.to, visits: 0, totalTime: 0 });
    }
    if (nav.to) nodeMap.get(nav.to)!.visits++;

    if (nav.from && nav.to && nav.from !== nav.to) {
      stepCount++;
      const key = `${nav.from}→${nav.to}`;
      const route = routeMap.get(key);
      if (route) {
        route.steps.push(stepCount);
      } else {
        routeMap.set(key, { from: nav.from, to: nav.to, steps: [stepCount] });
      }
    }
  }

  // Time on page: the gap until the next navigation
  for (let i = 0; i < navEvents.length - 1; i++) {
    const cur = navEvents[i]!;
    const next = navEvents[i + 1]!;
    const node = nodeMap.get(cur.to);
    if (node) node.totalTime += (next.timestamp - cur.timestamp) / 1000;
  }

  return { nodes: Array.from(nodeMap.values()), routes: Array.from(routeMap.values()) };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncateUrl(url: string, maxLen = 22): string {
  if (url === '/') return '/ (Home)';
  if (url.length <= maxLen) return url;
  return '…' + url.slice(-(maxLen - 1));
}

function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function stepLabel(steps: number[]): string {
  const shown = steps.slice(0, 3).join(',');
  return steps.length > 3 ? `${shown}…` : shown;
}

// Badge with the step numbers, sized to fit its text
function badge(x: number, y: number, label: string, fill: string): string {
  const w = Math.max(20, label.length * 7 + 10);
  return (
    `<rect x="${x - w / 2}" y="${y - 10}" width="${w}" height="20" rx="10" fill="${fill}"/>` +
    `<text x="${x}" y="${y + 4}" text-anchor="middle" fill="${COLOUR.badgeText}" font-size="11" font-weight="700">${escapeXml(label)}</text>`
  );
}

// Depth of a curved route, so longer jumps arc further out and do not collide
function arcDepth(span: number): number {
  return ARC_BASE + ARC_STEP * (span - 1);
}

export function generateFlowSVG(navEvents: NavigationEvent[]): string {
  const { nodes, routes } = buildFlowGraph(navEvents);

  if (nodes.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><text x="10" y="30" font-family="system-ui" font-size="14" fill="#888">No navigation events recorded</text></svg>';
  }

  const order = new Map(nodes.map((node, i) => [node.url, i]));
  const n = nodes.length;
  const totalSteps = routes.reduce((sum, r) => sum + r.steps.length, 0);

  // Work out how much room the curves need above and below the boxes
  let aboveDepth = 0;
  let belowDepth = 0;
  for (const route of routes) {
    const i = order.get(route.from)!;
    const j = order.get(route.to)!;
    if (j < i) aboveDepth = Math.max(aboveDepth, arcDepth(i - j));
    if (j > i + 1) belowDepth = Math.max(belowDepth, arcDepth(j - i));
  }
  const top = Math.max(150, TITLE_CLEARANCE + aboveDepth);

  const rowWidth = n * BOX_W + (n - 1) * GAP_X;
  const svgW = Math.max(MIN_WIDTH, rowWidth + 120);
  const left = (svgW - rowWidth) / 2;
  const x = (i: number) => left + i * (BOX_W + GAP_X);
  const cx = (i: number) => x(i) + BOX_W / 2;
  const midY = top + BOX_H / 2;
  const svgH = top + BOX_H + belowDepth + BOTTOM_MARGIN;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" font-family="system-ui, -apple-system, sans-serif">`;
  svg += `<rect width="${svgW}" height="${svgH}" fill="${COLOUR.background}"/>`;
  svg += `<defs>`;
  svg += `<marker id="flow-arrow-forward" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${COLOUR.forward}"/></marker>`;
  svg += `<marker id="flow-arrow-back" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${COLOUR.back}"/></marker>`;
  svg += `</defs>`;

  svg += `<text x="${svgW / 2}" y="30" text-anchor="middle" fill="${COLOUR.text}" font-size="15" font-weight="600">Navigation flow · ${totalSteps} steps, ${n} pages</text>`;
  svg += `<text x="${svgW / 2}" y="50" text-anchor="middle" fill="${COLOUR.muted}" font-size="12">Pages in order of first visit</text>`;

  // Routes (drawn before the boxes so the boxes sit on top)
  for (const route of routes) {
    const i = order.get(route.from)!;
    const j = order.get(route.to)!;
    const label = stepLabel(route.steps);

    if (j === i + 1) {
      // Next page along: a straight blue arrow
      const x1 = x(i) + BOX_W;
      const x2 = x(j);
      svg += `<line x1="${x1}" y1="${midY}" x2="${x2}" y2="${midY}" stroke="${COLOUR.forward}" stroke-width="2.5" marker-end="url(#flow-arrow-forward)"/>`;
      svg += badge((x1 + x2) / 2, midY - 18, label, COLOUR.forward);
    } else if (j > i + 1) {
      // Skipped ahead: a blue arc below the boxes
      const depth = arcDepth(j - i);
      const x1 = cx(i);
      const x2 = cx(j);
      const apexY = top + BOX_H + depth;
      svg += `<path d="M ${x1} ${top + BOX_H} Q ${(x1 + x2) / 2} ${top + BOX_H + 2 * depth} ${x2} ${top + BOX_H}" fill="none" stroke="${COLOUR.forward}" stroke-width="2" marker-end="url(#flow-arrow-forward)"/>`;
      svg += badge((x1 + x2) / 2, apexY, label, COLOUR.forward);
    } else if (j < i) {
      // Went back: a dashed orange arc above the boxes
      const depth = arcDepth(i - j);
      const x1 = cx(i);
      const x2 = cx(j);
      const apexY = top - depth;
      svg += `<path d="M ${x1} ${top} Q ${(x1 + x2) / 2} ${top - 2 * depth} ${x2} ${top}" fill="none" stroke="${COLOUR.back}" stroke-width="2" stroke-dasharray="6 5" marker-end="url(#flow-arrow-back)"/>`;
      svg += badge((x1 + x2) / 2, apexY, label, COLOUR.back);
    }
  }

  // Pages: one box each, with visit count and average time
  nodes.forEach((node, i) => {
    const avg = node.visits > 0 ? node.totalTime / node.visits : 0;
    const visitsLabel = `${node.visits} ${node.visits === 1 ? 'visit' : 'visits'} · avg ${formatSeconds(avg)}`;
    svg += `<rect x="${x(i)}" y="${top}" width="${BOX_W}" height="${BOX_H}" rx="8" fill="${COLOUR.boxFill}" stroke="${COLOUR.boxStroke}" stroke-width="1.5"/>`;
    svg += `<text x="${cx(i)}" y="${top + 23}" text-anchor="middle" fill="${COLOUR.text}" font-size="13" font-weight="600">${escapeXml(truncateUrl(node.url))}</text>`;
    svg += `<text x="${cx(i)}" y="${top + 41}" text-anchor="middle" fill="${COLOUR.muted}" font-size="11">${escapeXml(visitsLabel)}</text>`;
  });

  // Legend and Recap mention
  const legendY = top + BOX_H + belowDepth + 40;
  svg += `<text x="${svgW / 2}" y="${legendY}" text-anchor="middle" fill="${COLOUR.muted}" font-size="12">Blue = forward · Orange dashed = went back · Number = step order</text>`;
  svg += `<text x="${svgW - 16}" y="${svgH - 14}" text-anchor="end" fill="${COLOUR.muted}" font-size="11">www.recap-ux.com</text>`;

  svg += '</svg>';
  return svg;
}

export function downloadFlowDiagram(navEvents: NavigationEvent[], sessionName?: string): boolean {
  const svg = generateFlowSVG(navEvents);
  const name = sessionName ? `recap-flow-${sessionName}` : 'recap-flow';
  return downloadText(svg, 'image/svg+xml', buildFilename(name, 'svg'));
}
