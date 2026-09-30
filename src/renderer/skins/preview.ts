import { CanvasTexture, SRGBColorSpace } from 'three';
import type { MaterialDef } from '@shared/materials/schema';
import type { Project } from '@shared/project/schema';
import type { TemplateDrawing } from '@shared/uv/skinTemplate';
import { provideTexture } from '@renderer/materials/runtime';
import { drawTemplate } from './drawTemplate';
import { skinMaterials } from './commands';

/**
 * Skins on the car in the viewport (fork): the paint design being looked at
 * (or the template itself) replaces the colour of the materials it covers.
 * Only the viewport's copy changes; the project's materials stay as they are.
 */

/** The template drawn for the car, as a texture the materials can use. */
export const TEMPLATE_TEXTURE = 'jbforge://skin-template.png';

let templateCanvas: HTMLCanvasElement | null = null;
let templateTexture: CanvasTexture | null = null;

/** Draw (or redraw) the template texture shown on the car. */
export function showTemplateOnCar(d: TemplateDrawing): void {
  templateCanvas ??= document.createElement('canvas');
  templateCanvas.width = templateCanvas.height = 2048;
  drawTemplate(templateCanvas, d);
  // A new texture each time, so materials using it rebuild.
  templateTexture?.dispose();
  templateTexture = new CanvasTexture(templateCanvas);
  templateTexture.colorSpace = SRGBColorSpace;
  templateTexture.anisotropy = 8;
  provideTexture(TEMPLATE_TEXTURE, templateTexture);
}

const derived = new WeakMap<MaterialDef, Map<string, MaterialDef>>();

/** A material showing a colour texture (and colour) in place of its own, for the viewport only. */
function withColour(def: MaterialDef, key: string, map: string | null, colour: MaterialDef['layers'][number]['baseColor'] | null): MaterialDef {
  let byKey = derived.get(def);
  if (!byKey) derived.set(def, (byKey = new Map<string, MaterialDef>()));
  const cacheKey = `${key}|${map ?? ''}|${colour?.join(',') ?? ''}`;
  const hit = byKey.get(cacheKey);
  if (hit) return hit;
  const [top, ...rest] = def.layers;
  const out: MaterialDef = {
    ...def,
    id: `${def.id}~${key}`,
    // A skin replaces the paint: its texture is what the car shows.
    paint: false,
    layers: [{ ...top!, baseColor: colour ?? (map ? [1, 1, 1, 1] : top!.baseColor), maps: { ...top!.maps, ...(map ? { baseColorMap: map } : {}) } }, ...rest],
  };
  byKey.set(cacheKey, out);
  return out;
}

/** The materials the viewport draws, by id: the project's, with the previewed skin or template in place. */
export function previewDefs(doc: Pick<Project, 'materials' | 'materialSlots' | 'meshEdits' | 'meshCopies' | 'features'>, preview: string | null): Map<string, MaterialDef> {
  const defs = new Map(doc.materials.map((d) => [d.id, d]));
  if (!preview) return defs;
  if (preview === 'template') {
    for (const m of skinMaterials(doc).materials) defs.set(m.id, withColour(m, 'template', TEMPLATE_TEXTURE, null));
    return defs;
  }
  const skin = doc.features.skins.find((s) => s.id === preview);
  for (const [id, o] of Object.entries(skin?.overrides ?? {})) {
    const def = defs.get(id);
    if (def) defs.set(id, withColour(def, preview, o.baseColorMap, o.baseColor));
  }
  return defs;
}
