import { useEffect, useRef } from 'react';
import type { TapPoint } from '../lib/types';

interface Props {
  points: TapPoint[];
  /** Device aspect ratio (height / width). Defaults to a typical modern phone. */
  aspect?: number;
  width?: number;
  /** Optional screenshot of the screen to draw underneath. */
  backgroundUrl?: string | null;
}

// Colour ramp from transparent blue to red, like the web library's heatmap.
const STOPS: [number, [number, number, number]][] = [
  [0.0, [0, 0, 255]],
  [0.35, [0, 200, 255]],
  [0.55, [0, 230, 120]],
  [0.75, [255, 220, 0]],
  [1.0, [255, 40, 0]],
];

function colour(v: number): [number, number, number] {
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

export function Heatmap({ points, aspect = 2.16, width = 260, backgroundUrl = null }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const height = Math.round(width * aspect);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // 1. Accumulate intensity as soft grey circles.
    const radius = Math.max(14, width / 12);
    const alpha = Math.min(0.6, Math.max(0.06, 8 / Math.sqrt(points.length + 1)));
    for (const p of points) {
      const x = p.nx * width;
      const y = p.ny * height;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(0,0,0,${alpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    // 2. Map intensity to colour.
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
  }, [points, width, height]);

  return (
    <div className="phone" style={{ width, height }}>
      {backgroundUrl ? <img src={backgroundUrl} alt="" className="phone-bg" /> : <div className="phone-grid" />}
      <canvas ref={ref} style={{ width, height }} className="phone-canvas" />
      {points.length === 0 && <div className="phone-empty">No taps recorded</div>}
    </div>
  );
}
