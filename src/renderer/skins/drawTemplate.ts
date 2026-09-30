import type { TemplateDrawing } from '@shared/uv/skinTemplate';

/**
 * Draw a skin template on a canvas: the PNG painters open, the studio's
 * preview and the texture shown on the car. The same drawing is written as
 * SVG by templateSvg, so all three match.
 *
 * Colours here are the template's own (printed paper, not the app's theme).
 */
export function drawTemplate(canvas: HTMLCanvasElement, d: TemplateDrawing, opts: { background?: boolean; labels?: boolean } = {}): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const k = canvas.width / d.size;
  g.save();
  g.scale(k, k);
  g.clearRect(0, 0, d.size, d.size);
  if (opts.background !== false) {
    g.fillStyle = '#ffffff'; /* token-lint-ignore: template paper */
    g.fillRect(0, 0, d.size, d.size);
  }
  // Panels: each part's triangles in its colour (stroked in it too, hiding hairline seams).
  g.globalAlpha = 0.55;
  g.lineWidth = 1 / k;
  g.lineJoin = 'round';
  for (const f of d.fills) {
    g.fillStyle = f.color;
    g.strokeStyle = f.color;
    g.beginPath();
    for (let i = 0; i + 5 < f.tris.length; i += 6) {
      g.moveTo(f.tris[i]!, f.tris[i + 1]!);
      g.lineTo(f.tris[i + 2]!, f.tris[i + 3]!);
      g.lineTo(f.tris[i + 4]!, f.tris[i + 5]!);
      g.closePath();
    }
    g.fill();
    g.stroke();
  }
  g.globalAlpha = 1;
  // Outlines.
  g.strokeStyle = '#333333'; /* token-lint-ignore: template ink */
  g.lineWidth = Math.max(d.size / 2048, 1 / k);
  g.beginPath();
  for (let i = 0; i + 3 < d.outlines.length; i += 4) {
    g.moveTo(d.outlines[i]!, d.outlines[i + 1]!);
    g.lineTo(d.outlines[i + 2]!, d.outlines[i + 3]!);
  }
  g.stroke();
  // Guides: view frames and the centre line, dashed.
  const px = Math.max(10, Math.round(d.size / 110));
  g.strokeStyle = '#99aaaa'; /* token-lint-ignore: template guides */
  g.lineWidth = Math.max(d.size / 2048, 1 / k);
  g.setLineDash([px / 2, px / 3]);
  for (const f of d.frames) g.strokeRect(f.x, f.y, f.w, f.h);
  g.beginPath();
  for (let i = 0; i + 3 < d.guides.length; i += 4) {
    g.moveTo(d.guides[i]!, d.guides[i + 1]!);
    g.lineTo(d.guides[i + 2]!, d.guides[i + 3]!);
  }
  g.stroke();
  g.setLineDash([]);
  // Titles and the metre bar.
  g.fillStyle = '#555555'; /* token-lint-ignore: template ink */
  g.font = `bold ${px}px Arial, Helvetica, sans-serif`;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  for (const f of d.frames) g.fillText(f.title, f.x, Math.max(px, f.y - 4));
  g.strokeStyle = '#555555'; /* token-lint-ignore: template ink */
  g.lineWidth = Math.max(2, px / 4);
  g.beginPath();
  g.moveTo(d.scaleBar.x, d.scaleBar.y);
  g.lineTo(d.scaleBar.x + d.scaleBar.w, d.scaleBar.y);
  g.stroke();
  g.fillText('1 m', d.scaleBar.x, d.scaleBar.y - 4);
  // Part names, with a white halo so they read over any colour.
  if (opts.labels !== false) {
    g.font = `${px}px Arial, Helvetica, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = px / 4;
    g.strokeStyle = '#ffffff'; /* token-lint-ignore: template paper */
    g.fillStyle = '#222222'; /* token-lint-ignore: template ink */
    for (const l of d.labels) {
      g.strokeText(l.text, l.x, l.y);
      g.fillText(l.text, l.x, l.y);
    }
  }
  g.restore();
}
