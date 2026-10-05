import type { AiContext, AiField } from '@shared/ai/prompt';
import { slotTypeOf } from '@shared/export/jbeam';
import { BUILT_IN_TEMPLATES } from '@shared/lua/library';
import { partPrice } from '@shared/parts/materials';
import { editableFields } from '@shared/powertrain/edits';
import type { FittedSet, Project } from '@shared/project/schema';
import { partMass, partSettings } from '@shared/proxy/generate';
import { hingeProblem } from '@renderer/hinges/commands';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import { useSetData } from '@renderer/suspension/commands';

/** The open project as AI mode shows it to an AI: names and plain values only. */
export async function buildAiContext(doc: Project): Promise<AiContext> {
  const tax = currentTaxonomy();
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const meshes = new Map<string, number>();
  for (const [key, partId] of Object.entries(doc.assignments)) if (!doc.ignoredMeshes.includes(key)) meshes.set(partId, (meshes.get(partId) ?? 0) + 1);
  const nodes = new Map<string, number>();
  for (const n of doc.nodes) nodes.set(n.partId, (nodes.get(n.partId) ?? 0) + 1);

  const parts: AiContext['parts'] = doc.parts.map((p) => {
    const entry = tax.entry(p.taxonomyId);
    const settings = entry ? partSettings(doc, p, entry) : null;
    return {
      name: p.name,
      displayName: p.displayName,
      kind: entry?.label ?? p.taxonomyId,
      position: p.position,
      parent: p.parentPartId ? (byId.get(p.parentPartId)?.name ?? null) : null,
      construction: p.constructionMaterial,
      price: partPrice(p, entry),
      priceSet: p.price !== null,
      massKg: entry && settings ? partMass(p, entry, settings) : 0,
      massSet: doc.proxy.parts[p.id]?.massKg != null,
      nodes: nodes.get(p.id) ?? 0,
      meshes: meshes.get(p.id) ?? 0,
      slot: slotTypeOf(doc.parts, p),
      description: p.description,
      opens: !!entry?.openable,
      hinged: doc.hinges.some((h) => h.partId === p.id),
      hingeProblem: entry?.openable ? hingeProblem(doc, p.id) : 'it doesn’t open',
    };
  });

  const slots: Record<string, string[]> = {};
  for (const p of doc.parts) (slots[slotTypeOf(doc.parts, p)] ??= []).push(p.name);

  const fieldsOf = async (set: FittedSet | null): Promise<{ name: string; fields: AiField[] } | null> => {
    if (!set) return null;
    await useSetData.getState().ensure([set.setId]);
    const data = useSetData.getState().data[set.setId];
    if (!data) return { name: set.name, fields: [] };
    const fields = editableFields(data.parts).map((f) => ({ key: f.key, label: f.label, unit: f.unit, value: set.edits.fields[f.key] ?? f.value, min: f.min, max: f.max }));
    return { name: set.name, fields };
  };

  return {
    car: {
      name: doc.meta.name,
      brand: doc.meta.brand,
      bodyStyle: doc.meta.bodyStyle ?? '',
      country: doc.meta.country ?? '',
      years: doc.meta.years ? `${doc.meta.years.min}–${doc.meta.years.max}` : '',
    },
    parts,
    materials: doc.materials.map((m) => {
      const l = m.layers[0];
      return { name: m.name, color: l ? [l.baseColor[0], l.baseColor[1], l.baseColor[2]] : [1, 1, 1], metallic: l?.metallic ?? 0, roughness: l?.roughness ?? 0.5, clearCoat: l?.clearCoat ?? 0, opacity: l?.opacity ?? 1, game: !!m.gameMaterial };
    }),
    configs: doc.configs.map((k) => ({ name: k.name, type: k.type, parts: k.parts })),
    slots,
    scripts: {
      templates: BUILT_IN_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        params: t.params.filter((p) => p.kind !== 'meshes' && p.kind !== 'mesh' && p.kind !== 'electrics').map((p) => ({ id: p.id, label: p.label, kind: p.kind, ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}), ...(p.options ? { options: p.options.map((o) => o.value) } : {}), default: p.default })),
      })),
      present: (doc.scripts ?? []).flatMap((s) => (s.templateId ? [s.templateId] : [])),
    },
    engine: await fieldsOf(doc.powertrain.engine),
    gearbox: await fieldsOf(doc.powertrain.gearbox),
    tuning: doc.variables.map((v) => ({ part: byId.get(v.partId)?.name ?? '?', setting: v.setting, min: v.min, max: v.max, default: v.default })),
  };
}
