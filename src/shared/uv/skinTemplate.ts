import type { SkinLayout, SkinView } from './skinUnwrap';

/**
 * The skin template (fork): what a painter opens in Photoshop, GIMP or
 * Inkscape to paint a skin. Every panel filled in a colour of its own and
 * outlined, named where it sits, the views framed and titled with the way
 * the car faces, and a one-metre bar. Built once as a drawing in image
 * pixels, then drawn on a canvas (PNG, and the preview) or written as SVG
 * with a layer each for fills, outlines, labels and guides.
 */

export interface TemplatePiece {
  /** The part's name, shown on the template. */
  part: string;
  /** Its colour, "#rrggbb". */
  color: string;
  /** u, v × 3 per triangle. */
  uv: ArrayLike<number>;
  views: readonly SkinView[];
}

export interface TemplateDrawing {
  size: number;
  /** One per part: its triangles as x, y × 3 each (image pixels, y down). */
  fills: { part: string; color: string; tris: number[] }[];
  /** Panel outlines: x1, y1, x2, y2 per segment. */
  outlines: number[];
  labels: { text: string; x: number; y: number; px: number }[];
  frames: { view: SkinView; x: number; y: number; w: number; h: number; title: string }[];
  /** The one-metre bar. */
  scaleBar: { x: number; y: number; w: number };
  /** Guide lines: the centre line on the top view, the ground line on the sides. */
  guides: number[];
}

const TITLES: Record<SkinView, string> = {
  left: 'Left side  ·  front ←',
  top: 'Top  ·  front ←  ·  right side at the top',
  right: 'Right side  ·  front →',
  front: 'Front',
  rear: 'Rear',
  bottom: 'Underside  ·  front ←',
};

/** A clear colour for the i-th part (golden-angle hues, light enough to paint over). */
export function partColor(i: number): string {
  const h = (i * 137.508) % 360;
  const [s, l] = [0.55, 0.72];
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Build the template drawing at `size` pixels square. */
export function buildTemplate(layout: SkinLayout, pieces: readonly TemplatePiece[], size: number): TemplateDrawing {
  const X = (u: number) => u * size;
  const Y = (v: number) => (1 - v) * size;
  const fills = new Map<string, { part: string; color: string; tris: number[] }>();
  const outlines: number[] = [];
  // Label spots: area-weighted centre per part and view.
  const spots = new Map<string, { part: string; view: SkinView; a: number; x: number; y: number }>();
  for (const p of pieces) {
    const fill = fills.get(p.part) ?? { part: p.part, color: p.color, tris: [] };
    fills.set(p.part, fill);
    // Edges used by one triangle of this piece (in the same view) are its outline.
    const edgeUse = new Map<string, { n: number; seg: number[] }>();
    for (let t = 0; t < p.views.length; t++) {
      const pts: number[] = [];
      for (let k = 0; k < 3; k++) pts.push(X(p.uv[t * 6 + k * 2]!), Y(p.uv[t * 6 + k * 2 + 1]!));
      // One winding for all, so faces lying on each other (a panel's outside and inside) add up
      // under the non-zero fill rule instead of cancelling out.
      if ((pts[2]! - pts[0]!) * (pts[5]! - pts[1]!) - (pts[4]! - pts[0]!) * (pts[3]! - pts[1]!) < 0) {
        [pts[2], pts[4]] = [pts[4]!, pts[2]!];
        [pts[3], pts[5]] = [pts[5]!, pts[3]!];
      }
      fill.tris.push(...pts);
      const area = Math.abs((pts[2]! - pts[0]!) * (pts[5]! - pts[1]!) - (pts[4]! - pts[0]!) * (pts[3]! - pts[1]!)) / 2;
      const key = `${p.part}|${p.views[t]}`;
      const s = spots.get(key) ?? { part: p.part, view: p.views[t]!, a: 0, x: 0, y: 0 };
      s.a += area;
      s.x += ((pts[0]! + pts[2]! + pts[4]!) / 3) * area;
      s.y += ((pts[1]! + pts[3]! + pts[5]!) / 3) * area;
      spots.set(key, s);
      for (let k = 0; k < 3; k++) {
        const [ax, ay, bx, by] = [pts[k * 2]!, pts[k * 2 + 1]!, pts[((k + 1) % 3) * 2]!, pts[((k + 1) % 3) * 2 + 1]!];
        const ka = `${p.views[t]}:${Math.round(ax * 4)},${Math.round(ay * 4)}`;
        const kb = `${p.views[t]}:${Math.round(bx * 4)},${Math.round(by * 4)}`;
        if (ka === kb) continue;
        const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const e = edgeUse.get(ek);
        if (e) e.n++;
        else edgeUse.set(ek, { n: 1, seg: [ax, ay, bx, by] });
      }
    }
    for (const e of edgeUse.values()) if (e.n === 1) outlines.push(...e.seg);
  }
  const labelPx = Math.max(10, Math.round(size / 110));
  const labels: TemplateDrawing['labels'] = [];
  // Biggest areas first, so the main panels keep their spot; a label that would sit on another moves off it.
  for (const s of [...spots.values()].sort((a, b) => b.a - a.a)) {
    // Only where the part shows enough to write on.
    if (s.a < (labelPx * labelPx * s.part.length) / 2) continue;
    const w = s.part.length * labelPx * 0.55;
    // Kept on the sheet.
    const x = Math.min(size - w / 2 - labelPx / 2, Math.max(w / 2 + labelPx / 2, s.x / s.a));
    let y = s.y / s.a;
    const hits = (yy: number) => labels.some((l) => Math.abs(l.x - x) < (w + l.text.length * labelPx * 0.55) / 2 && Math.abs(l.y - yy) < labelPx * 1.2);
    for (let i = 1; i <= 6 && hits(y); i++) y = s.y / s.a + labelPx * 1.3 * Math.ceil(i / 2) * (i % 2 ? 1 : -1);
    labels.push({ text: s.part, x, y, px: labelPx });
  }
  const frames: TemplateDrawing['frames'] = [];
  const seen = new Set<string>();
  for (const view of ['left', 'top', 'right', 'front', 'rear', 'bottom'] as const) {
    const r = layout.rects[view];
    if (!r) continue;
    const key = r.join(',');
    if (seen.has(key)) continue; // one design for both sides: one frame
    seen.add(key);
    const title = layout.bothSides && view === 'left' ? 'Both sides (the right is mirrored)  ·  front ←' : view === 'bottom' && !layout.bottom ? 'Underside (small: rarely seen)' : TITLES[view];
    frames.push({ view, x: X(r[0]), y: Y(r[1] + r[3]), w: r[2] * size, h: r[3] * size, title });
  }
  const guides: number[] = [];
  const top = layout.rects.top;
  // The car's centre line on the top view.
  const midV = top[1] + ((layout.max[0] - (layout.min[0] + layout.max[0]) / 2) * layout.scale);
  guides.push(X(top[0]), Y(midV), X(top[0] + top[2]), Y(midV));
  const last = frames[frames.length - 1]!;
  const scaleBar = { x: size - layout.scale * size - size * 0.02, y: Math.min(size - labelPx, last.y + last.h + labelPx * 2), w: layout.scale * size };
  return { size, fills: [...fills.values()], outlines, labels, frames, scaleBar, guides };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (v: number) => Math.round(v * 10) / 10;

/** The drawing as a layered SVG (Inkscape layers; Photoshop and GIMP import it as paths). */
export function templateSvg(d: TemplateDrawing, title: string): string {
  const layer = (id: string, label: string, body: string) => `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${esc(label)}">\n${body}\n</g>`;
  const fills = d.fills
    .map((f) => {
      let path = '';
      for (let i = 0; i + 5 < f.tris.length; i += 6) path += `M${r1(f.tris[i]!)} ${r1(f.tris[i + 1]!)}L${r1(f.tris[i + 2]!)} ${r1(f.tris[i + 3]!)}L${r1(f.tris[i + 4]!)} ${r1(f.tris[i + 5]!)}Z`;
      return `<path id="${esc(slugId(f.part))}" data-part="${esc(f.part)}" fill="${f.color}" d="${path}"/>`;
    })
    .join('\n');
  let outline = '';
  for (let i = 0; i + 3 < d.outlines.length; i += 4) outline += `M${r1(d.outlines[i]!)} ${r1(d.outlines[i + 1]!)}L${r1(d.outlines[i + 2]!)} ${r1(d.outlines[i + 3]!)}`;
  const labels = d.labels.map((l) => `<text x="${r1(l.x)}" y="${r1(l.y)}" font-size="${l.px}" text-anchor="middle" dominant-baseline="middle">${esc(l.text)}</text>`).join('\n');
  const frames = d.frames.map((f) => `<rect x="${r1(f.x)}" y="${r1(f.y)}" width="${r1(f.w)}" height="${r1(f.h)}"/>`).join('\n');
  const titles = [...d.frames.map((f) => ({ x: f.x, y: f.y - 4, text: f.title })), { x: d.scaleBar.x, y: d.scaleBar.y - 4, text: '1 m' }].map((t) => `<text class="title" x="${r1(t.x)}" y="${r1(t.y)}">${esc(t.text)}</text>`).join('\n');
  let guides = '';
  for (let i = 0; i + 3 < d.guides.length; i += 4) guides += `M${r1(d.guides[i]!)} ${r1(d.guides[i + 1]!)}L${r1(d.guides[i + 2]!)} ${r1(d.guides[i + 3]!)}`;
  const px = Math.max(10, Math.round(d.size / 110));
  const bar = `<path d="M${r1(d.scaleBar.x)} ${r1(d.scaleBar.y)}h${r1(d.scaleBar.w)}" stroke="#555" stroke-width="${Math.max(2, px / 4)}"/>`;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${d.size}" height="${d.size}" viewBox="0 0 ${d.size} ${d.size}">`,
    `<title>${esc(title)}</title>`,
    `<style>text{font-family:Arial,Helvetica,sans-serif;fill:#222}.title{font-size:${px}px;font-weight:bold;fill:#555}</style>`,
    `<rect width="${d.size}" height="${d.size}" fill="#ffffff"/>`,
    layer('panels', 'Panels (paint over these)', `<g opacity="0.55">\n${fills}\n</g>`),
    layer('outlines', 'Outlines', `<path d="${outline}" fill="none" stroke="#333" stroke-width="${Math.max(1, d.size / 2048)}"/>`),
    layer('labels', 'Part names', labels),
    layer('guides', 'Guides', `<g fill="none" stroke="#9aa" stroke-dasharray="6 4">\n${frames}\n<path d="${guides}"/>\n</g>\n${bar}\n${titles}`),
    `</svg>`,
    '',
  ].join('\n');
}

function slugId(s: string): string {
  const id = s.replace(/[^A-Za-z0-9_-]+/g, '_');
  return /^[A-Za-z]/.test(id) ? id : `p_${id}`;
}
