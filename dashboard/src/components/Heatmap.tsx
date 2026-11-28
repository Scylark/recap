import { useEffect, useRef } from 'react';
import type { TapPoint } from '../lib/types';
import { drawHeat } from './heat';

interface Props {
  points: TapPoint[];
  /** Device aspect ratio (height / width). Defaults to a typical modern phone. */
  aspect?: number;
  width?: number;
  /** Optional screenshot of the screen to draw underneath. */
  backgroundUrl?: string | null;
}

export function Heatmap({ points, aspect = 2.16, width = 260, backgroundUrl = null }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const height = Math.round(width * aspect);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    drawHeat(canvas, points.map((p) => ({ x: p.nx * width, y: p.ny * height })), width, height, Math.max(14, width / 12));
  }, [points, width, height]);

  return (
    <div className="phone" style={{ width, height }}>
      {backgroundUrl ? <img src={backgroundUrl} alt="" className="phone-bg" /> : <div className="phone-grid" />}
      <canvas ref={ref} style={{ width, height }} className="phone-canvas" />
      {points.length === 0 && <div className="phone-empty">No taps recorded</div>}
    </div>
  );
}
