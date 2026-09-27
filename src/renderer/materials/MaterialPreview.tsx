import { useEffect, useRef, useState } from 'react';
import type { MaterialDef } from '@shared/materials/schema';
import { Select } from '@renderer/ui/components/Select';
import { cx } from '@renderer/ui/cx';
import { materialFor, useTextureVersion } from './runtime';
import { MaterialStage, materialThumbnail, PREVIEW_BACKGROUNDS, PREVIEW_SHAPES, type PreviewBackground, type PreviewShape } from './preview';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import styles from './MaterialPreview.module.css';

const SHAPE_LABELS: Record<PreviewShape, string> = { sphere: 'Sphere', cube: 'Cube', panel: 'Flat panel', cylinder: 'Cylinder', knot: 'Knot' };
const BG_LABELS: Record<PreviewBackground, string> = { studio: 'Studio', dark: 'Dark', light: 'Light', checker: 'Checker', sky: 'Sky' };

/** Remembered preview shape and background (per machine). */
export const usePreviewPrefs = create<{ shape: PreviewShape; background: PreviewBackground; set: (p: Partial<{ shape: PreviewShape; background: PreviewBackground }>) => void }>()(
  persist((set) => ({ shape: 'sphere', background: 'studio', set: (p) => set(p) }), { name: 'jbforge.materialPreview', storage: createJSONStorage(() => localStorage) }),
);

/** Live 3D preview of the material being edited: drag to turn it, every change shows at once. */
export function MaterialPreview({ def }: { def: MaterialDef }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<MaterialStage | null>(null);
  const shape = usePreviewPrefs((s) => s.shape);
  const background = usePreviewPrefs((s) => s.background);
  const set = usePreviewPrefs((s) => s.set);
  const textureVersion = useTextureVersion((s) => s.version);

  useEffect(() => {
    if (!canvas.current) return;
    const s = new MaterialStage(canvas.current);
    stage.current = s;
    return () => {
      s.dispose();
      stage.current = null;
    };
  }, []);
  useEffect(() => stage.current?.setShape(shape), [shape]);
  useEffect(() => stage.current?.setBackground(background), [background]);
  // materialFor rebuilds when the definition (an immer snapshot) or a texture changes.
  useEffect(() => stage.current?.setMaterial(materialFor(def)), [def, textureVersion]);

  return (
    <div className={styles.preview} data-testid="material-preview">
      <canvas ref={canvas} className={styles.canvas} />
      <div className={styles.controls}>
        <Select value={shape} onChange={(v) => set({ shape: v })} options={PREVIEW_SHAPES.map((v) => ({ value: v, label: SHAPE_LABELS[v] }))} aria-label="Preview shape" className={styles.select} />
        <Select value={background} onChange={(v) => set({ background: v })} options={PREVIEW_BACKGROUNDS.map((v) => ({ value: v, label: BG_LABELS[v] }))} aria-label="Preview background" className={styles.select} />
      </div>
    </div>
  );
}

/** A rendered thumbnail of a material, made when it scrolls into view. */
export function MaterialThumb({ def, shape = 'sphere', className }: { def: MaterialDef; shape?: PreviewShape; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      void materialThumbnail(def, shape).then((url) => alive && setSrc(url));
    });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [def, shape]);
  return (
    <span ref={ref} className={cx(styles.thumb, className)} aria-hidden>
      {src && <img src={src} alt="" />}
    </span>
  );
}
