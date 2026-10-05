import type { CheckedChange } from '@shared/ai/check';
import { projectStore } from '@renderer/app/stores/project';
import { addConfig, setConfigPart, updateConfig, updateConfigInfo, updateModelInfo } from '@renderer/configs/commands';
import { addHinge } from '@renderer/hinges/commands';
import { updateLayer } from '@renderer/materials/commands';
import { updatePart } from '@renderer/parts/commands';
import { setTuningVar } from '@renderer/parts/TuningVarsSection';
import { setPowertrainField } from '@renderer/powertrain/commands';
import { addFromTemplate, setScriptParam } from '@renderer/scripts/commands';
import { updateProxySettings } from '@renderer/structure/generate';
import { handlesFromHinges } from '@renderer/triggers/commands';

/**
 * Apply the changes the modder kept, through the same commands the app's own controls use, as
 * one undo step ("AI: …"). Returns what was done and what failed on the way (a part removed
 * since the reply was checked, say), in words for Iterate.
 */
export async function applyChanges(changes: readonly CheckedChange[], label: string): Promise<{ applied: string[]; failed: string[] }> {
  const applied: string[] = [];
  const failed: string[] = [];
  await projectStore.getState().group(`AI: ${label}`, () => {
    for (const c of changes) {
      if (!c.ok || !c.change) continue;
      const doc = projectStore.getState().doc;
      if (!doc) break;
      const ch = c.change;
      const part = 'part' in ch ? doc.parts.find((p) => p.name === ch.part) : undefined;
      if ('part' in ch && !part) {
        failed.push(`${c.text}: the part is gone`);
        continue;
      }
      try {
        switch (ch.do) {
          case 'rename':
            updatePart(part!.id, { displayName: ch.displayName });
            break;
          case 'describe':
            updatePart(part!.id, { description: ch.description });
            break;
          case 'price':
            updatePart(part!.id, { price: Math.round(ch.price) });
            break;
          case 'construction':
            updatePart(part!.id, { constructionMaterial: ch.material });
            break;
          case 'mass':
            updateProxySettings(part!.id, { massKg: ch.kg });
            break;
          case 'structure':
            updateProxySettings(part!.id, { ...(ch.bracing ? { bracing: ch.bracing } : {}), ...(ch.attachment ? { attachment: ch.attachment } : {}), ...(ch.detail !== undefined ? { detail: ch.detail } : {}) });
            break;
          case 'hinge':
            addHinge(part!.id);
            if (!projectStore.getState().doc?.hinges.some((h) => h.partId === part!.id)) throw new Error('the hinge couldn’t be placed');
            break;
          case 'handles':
            handlesFromHinges();
            break;
          case 'script': {
            const id = addFromTemplate(ch.template);
            if (!id) throw new Error('the template wasn’t found');
            for (const [k, v] of Object.entries(ch.params ?? {})) setScriptParam(id, k, v);
            break;
          }
          case 'config': {
            const existing = doc.configs.find((k) => k.name.toLowerCase() === ch.name.toLowerCase());
            const id = existing?.id ?? addConfig(null);
            updateConfig(id, { name: ch.name, ...(ch.type !== undefined ? { type: ch.type } : {}), ...(ch.description !== undefined ? { description: ch.description } : {}) });
            for (const [slot, name] of Object.entries(ch.parts ?? {})) setConfigPart(id, slot, name);
            if (ch.years || ch.population !== undefined || ch.value !== undefined) updateConfigInfo(id, { ...(ch.years ? { years: ch.years } : {}), ...(ch.population !== undefined ? { population: ch.population } : {}), ...(ch.value !== undefined ? { value: ch.value } : {}) });
            break;
          }
          case 'modelInfo':
            updateModelInfo({ ...(ch.bodyStyle ? { bodyStyle: ch.bodyStyle } : {}), ...(ch.country ? { country: ch.country } : {}), ...(ch.years ? { years: ch.years } : {}) });
            break;
          case 'material': {
            const m = doc.materials.find((x) => x.name === ch.material);
            if (!m) throw new Error('the material is gone');
            const base = m.layers[0]?.baseColor ?? [1, 1, 1, 1];
            updateLayer(m.id, 0, {
              ...(ch.color ? { baseColor: [ch.color[0], ch.color[1], ch.color[2], base[3] ?? 1] as [number, number, number, number] } : {}),
              ...(ch.metallic !== undefined ? { metallic: ch.metallic } : {}),
              ...(ch.roughness !== undefined ? { roughness: ch.roughness } : {}),
              ...(ch.clearCoat !== undefined ? { clearCoat: ch.clearCoat } : {}),
              ...(ch.opacity !== undefined ? { opacity: ch.opacity } : {}),
            });
            break;
          }
          case 'powertrain':
            setPowertrainField(ch.unit, ch.key, ch.value);
            break;
          case 'tuning':
            setTuningVar(part!.id, ch.setting, { min: ch.min, max: ch.max, default: ch.default });
            break;
        }
        applied.push(c.text);
      } catch (err) {
        failed.push(`${c.text}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
  return { applied, failed };
}
