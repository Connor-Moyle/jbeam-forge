import { useEffect, useMemo, useRef } from 'react';
import type { BufferGeometry } from 'three';
import { useSceneStore } from '@renderer/app/stores/scene';
import styles from './MeshSection.module.css';

/**
 * The mesh's UV layout: its triangles drawn flat in texture space, with the
 * 0–1 texture square marked, so stretched, overlapping or off-sheet islands
 * show before they're painted or exported.
 */

const MAX_TRIANGLES = 60_000;

/** Triangle corners in texture space, [u, v] × 3 per triangle (at most MAX_TRIANGLES, evenly picked). */
export function uvTriangles(g: BufferGeometry): Float32Array {
  const uv = g.getAttribute('uv');
  if (!uv) return new Float32Array(0);
  const index = g.index;
  const total = Math.floor((index ? index.count : uv.count) / 3);
  const step = Math.max(1, Math.ceil(total / MAX_TRIANGLES));
  const out = new Float32Array(Math.ceil(total / step) * 6);
  let o = 0;
  for (let t = 0; t < total; t += step) {
    for (let k = 0; k < 3; k++) {
      const i = index ? index.getX(t * 3 + k) : t * 3 + k;
      out[o++] = uv.getX(i);
      out[o++] = uv.getY(i);
    }
  }
  return out.subarray(0, o);
}

/** The square view that holds the 0–1 sheet and every corner: [minU, minV, span]. */
export function uvView(tris: Float32Array): [number, number, number] {
  let lo = [0, 0];
  let hi = [1, 1];
  for (let i = 0; i + 1 < tris.length; i += 2) {
    lo = [Math.min(lo[0]!, tris[i]!), Math.min(lo[1]!, tris[i + 1]!)];
    hi = [Math.max(hi[0]!, tris[i]!), Math.max(hi[1]!, tris[i + 1]!)];
  }
  const span = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!) || 1;
  return [lo[0]!, lo[1]!, span];
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function UvLayout({ meshKey }: { meshKey: string }) {
  const sources = useSceneStore((s) => s.sources);
  const geometry = useMemo(() => {
    for (const src of Object.values(sources)) {
      const m = src.meshes.find((x) => x.key === meshKey);
      if (m) return m.geometry;
    }
    return null;
  }, [sources, meshKey]);
  const tris = useMemo(() => (geometry ? uvTriangles(geometry) : new Float32Array(0)), [geometry]);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const size = c.width;
    g.clearRect(0, 0, size, size);
    const [u0, v0, span] = uvView(tris);
    const pad = 6;
    const k = (size - pad * 2) / span;
    const x = (u: number) => pad + (u - u0) * k;
    const y = (v: number) => size - pad - (v - v0) * k;
    g.fillStyle = css('--bg-3');
    g.fillRect(x(0), y(1), k, k);
    g.strokeStyle = css('--accent') || css('--text-1');
    g.lineWidth = 1;
    g.strokeRect(x(0), y(1), k, k);
    g.strokeStyle = css('--text-2');
    g.globalAlpha = 0.55;
    g.lineWidth = 0.5;
    g.beginPath();
    for (let i = 0; i + 5 < tris.length; i += 6) {
      g.moveTo(x(tris[i]!), y(tris[i + 1]!));
      g.lineTo(x(tris[i + 2]!), y(tris[i + 3]!));
      g.lineTo(x(tris[i + 4]!), y(tris[i + 5]!));
      g.closePath();
    }
    g.stroke();
    g.globalAlpha = 1;
  }, [tris]);

  if (!geometry) return null;
  if (!tris.length) return <p className={styles.note}>This mesh has no texture coordinates. Project some below.</p>;
  return <canvas ref={ref} width={240} height={240} className={styles.uvLayout} aria-label="UV layout" data-testid="uv-layout" />;
}
