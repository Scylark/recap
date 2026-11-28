// Drawing tap heat onto a canvas: soft grey circles for intensity, then a colour ramp from blue
// (a few taps) to red (most taps). Shared by the app screen map and the web page map.

const STOPS: [number, [number, number, number]][] = [
  [0.0, [0, 0, 255]],
  [0.35, [0, 200, 255]],
  [0.55, [0, 230, 120]],
  [0.75, [255, 220, 0]],
  [1.0, [255, 40, 0]],
];

export function colour(v: number): [number, number, number] {
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i]!;
    const [p0, c0] = STOPS[i - 1]!;
    if (v <= p1) {
      const k = (v - p0) / (p1 - p0);
      return [0, 1, 2].map((j) => Math.round(c0[j]! + (c1[j]! - c0[j]!) * k)) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1]![1];
}

/**
 * The most canvas pixels drawn: past this the map draws at a lower resolution rather than fail.
 * iOS Safari refuses a canvas over about 16.7 million pixels.
 */
export const MAX_PIXELS = 16_000_000;

/**
 * Device pixels per CSS px for a canvas of width x height: the screen's own, or less so the canvas
 * stays within MAX_PIXELS. There is no lower limit: the cap always wins, whatever the size asked for.
 */
export function heatResolution(width: number, height: number, want = 1): number {
  return Math.min(want, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)));
}

/**
 * Draw `points` (CSS px within width × height) onto `canvas`, sized to those CSS px. Returns the
 * resolution used (device pixels per CSS px).
 */
export function drawHeat(
  canvas: HTMLCanvasElement,
  points: { x: number; y: number }[],
  width: number,
  height: number,
  radius: number,
): number {
  const want = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const dpr = heatResolution(width, height, want);
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  // The colour pass reads the whole canvas back once per draw.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!points.length) return dpr;

  const alpha = Math.min(0.6, Math.max(0.06, 8 / Math.sqrt(points.length + 1)));
  for (const p of points) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
  }

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    if (a === 0) continue;
    const [r, g, b] = colour(a);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = Math.round(Math.min(1, a * 1.6) * 210);
  }
  ctx.putImageData(img, 0, 0);
  return dpr;
}
