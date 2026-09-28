import { useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, Combine, Copy, FolderOpen, Library, Palette, Plus, Share2, Trash2, X } from 'lucide-react';
import { useMergeUi } from '@renderer/materials/MergeDialog';
import { MaterialPreview, MaterialThumb } from '@renderer/materials/MaterialPreview';
import { saveToLibrary, shareMaterial, useLibrary } from '@renderer/materials/LibraryDialog';
import { EMPTY_ARR } from '@shared/empty';
import { BLEND_OPS, TEXTURE_SLOTS, type MaterialDef, type MaterialLayer, type TextureSlot } from '@shared/materials/schema';
import { fuzzyScore } from '@shared/fuzzy';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { slotsOf } from '@renderer/materials/seed';
import * as mc from '@renderer/materials/commands';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { CollapsibleSection } from '@renderer/ui/components/CollapsibleSection';
import { EmptyState } from '@renderer/ui/components/EmptyState';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Textarea } from '@renderer/ui/components/Textarea';
import { Toggle } from '@renderer/ui/components/Toggle';
import { cx } from '@renderer/ui/cx';
import { setMaterialSlot } from '@renderer/paint/commands';
import { Swatch } from '@renderer/paint/PaintsPanel';
import { usePainter } from '@renderer/paint/painter';
import { bakeAmbientOcclusion, DEFAULT_AO, useAoBake } from '@renderer/paint/aoBake';
import { useOptionalShell } from '@renderer/shell/ShellContext';
import styles from './MaterialsPanel.module.css';

const SLOT_LABELS: Record<TextureSlot, string> = {
  baseColorMap: 'Base colour',
  normalMap: 'Normal',
  metallicMap: 'Metallic',
  roughnessMap: 'Roughness',
  ambientOcclusionMap: 'Ambient occlusion',
  emissiveMap: 'Emissive',
  opacityMap: 'Opacity',
  clearCoatMap: 'Clear coat',
  colorPaletteMap: 'Paint mask (R/G/B = paint 1/2/3)',
  detailNormalMap: 'Detail normal',
};

const hex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const fileName = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);

/** Every material in the project: pick one to edit it; selecting a mesh shows what it uses. */
export function MaterialsPanel() {
  const materials = useProjectStore((s) => s.doc?.materials ?? EMPTY_ARR);
  const slots = useProjectStore((s) => s.doc?.materialSlots);
  const selection = useSceneStore((s) => s.selection);
  const selected = mc.useMaterialUi((s) => s.selected);
  const select = mc.useMaterialUi((s) => s.select);
  const [query, setQuery] = useState('');

  // Picking a mesh in the viewport or tree jumps to its material.
  useEffect(() => {
    const key = selection[selection.length - 1];
    const ids = key && slots ? slotsOf({ materialSlots: slots }, key) : undefined;
    if (ids?.[0]) select(ids[0]);
  }, [selection, slots, select]);

  const usage = useMemo(() => {
    const n = new Map<string, number>();
    for (const ids of Object.values(slots ?? {})) for (const id of new Set(ids)) n.set(id, (n.get(id) ?? 0) + 1);
    return n;
  }, [slots]);
  const shown = useMemo(
    () =>
      materials
        .map((m) => ({ m, score: fuzzyScore(query, m.name) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => (query ? b.score - a.score : a.m.name.localeCompare(b.m.name)))
        .map((r) => r.m),
    [materials, query],
  );
  const current = materials.find((m) => m.id === selected);

  if (!materials.length) {
    return <EmptyState icon={Palette} message="No materials yet. Import a model and its materials and textures come in automatically." action={{ label: 'Open the library', icon: Library, onClick: () => useLibrary.getState().setOpen(true) }} />;
  }

  return (
    <div className={styles.panel} data-testid="materials-panel">
      <div className={styles.listHeader}>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${materials.length} materials`} aria-label="Search materials" />
        <IconButton icon={Library} label="Material library" size="sm" onClick={() => useLibrary.getState().setOpen(true)} data-testid="material-library" />
        <IconButton icon={Combine} label="Merge duplicate materials" size="sm" onClick={() => useMergeUi.getState().setOpen(true)} data-testid="material-merge" />
        <IconButton icon={Plus} label="New material" size="sm" onClick={() => void mc.createMaterial()} data-testid="material-new" />
      </div>
      <ScrollArea className={styles.list}>
        <ul className={styles.items} role="listbox" aria-label="Materials">
          {shown.map((m) => (
            <li
              key={m.id}
              role="option"
              aria-selected={m.id === selected}
              className={cx(styles.item, m.id === selected && styles.active)}
              onClick={() => select(m.id)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(mc.MIME_MATERIAL, m.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              title="Drag onto a mesh in the viewport or the Scene tree"
              data-testid="material-row"
            >
              <MaterialThumb def={m} className={styles.listThumb} />
              <span className={styles.name}>{m.name}</span>
              {m.paint && <Badge>paint</Badge>}
              {m.translucent && <Badge>glass</Badge>}
              {m.gameMaterial && <Badge>game</Badge>}
              <span className={styles.count}>{usage.get(m.id) ?? 0}</span>
            </li>
          ))}
        </ul>
      </ScrollArea>
      {/* Pinned above the settings so it stays in view while you scroll and tweak. */}
      {current && (
        <div className={styles.previewSlot}>
          <MaterialPreview def={current} />
        </div>
      )}
      <ScrollArea className={styles.editor}>{current ? <MaterialEditor key={current.id} def={current} used={usage.get(current.id) ?? 0} /> : <p className={styles.hint}>Select a material to edit it, or pick a mesh to jump to its material.</p>}</ScrollArea>
    </div>
  );
}


function MaterialEditor({ def, used }: { def: MaterialDef; used: number }) {
  const layerIndex = mc.useMaterialUi((s) => Math.min(s.layer, def.layers.length - 1));
  const setLayer = mc.useMaterialUi((s) => s.setLayer);
  const selection = useSceneStore((s) => s.selection);
  const others = useProjectStore((s) => s.doc?.materials ?? EMPTY_ARR);
  const layer = def.layers[layerIndex]!;
  const paints = useProjectStore((s) => s.doc?.paints);
  const shell = useOptionalShell();
  const showPaints = () => {
    shell?.showPanel('paints');
    usePainter.getState().set({ materialId: def.id });
  };
  const paintFor = (i: number) => paints?.list.find((p) => p.id === paints.defaults[i]);
  const set = (patch: Partial<MaterialLayer>) => mc.updateLayer(def.id, layerIndex, patch);
  const setDef = (patch: Partial<MaterialDef>) => mc.updateMaterial(def.id, patch);

  return (
    <div className={styles.form} data-testid="material-editor">
      <NameField def={def} />
      <div className={styles.actions}>
        <Button size="sm" onClick={() => mc.assignMaterial(def.id, selection)} disabled={!selection.length} data-testid="material-apply">
          Apply to {selection.length || ''} selected
        </Button>
        <IconButton icon={Copy} label="Duplicate" size="sm" onClick={() => void mc.duplicateMaterial(def.id)} />
        <IconButton icon={BookmarkPlus} label="Save to your library" size="sm" onClick={() => void saveToLibrary(def)} data-testid="material-save-library" />
        <IconButton icon={Share2} label="Share as a .jbmat file" size="sm" onClick={() => void shareMaterial(def)} />
        <IconButton icon={Trash2} label={used ? `Delete (its ${used} meshes go back to their imported look)` : 'Delete'} size="sm" onClick={() => mc.deleteMaterial(def.id, null)} />
      </div>

      <FieldGroup title="Kind">
        <Toggle checked={def.paint} onChange={(paint) => setDef({ paint })} label="Car paint (uses the player's paint colours)" />
        {def.paint && (
          <Field label="Paint slot" hint="Put all of it on one of the car's three paints, or paint which goes where in the Paints panel.">
            <div className={styles.slotRow}>
              {[0, 1, 2].map((i) => (
                <Button key={i} size="sm" onClick={() => void setMaterialSlot(def.id, i as 0 | 1 | 2)} data-testid={`material-slot-${i + 1}`}>
                  <Swatch paint={paintFor(i)} /> Paint {i + 1}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => showPaints()}>
                Paint on the car…
              </Button>
            </div>
          </Field>
        )}
        <Field label="Use a BeamNG material instead" hint="Type the name of one of the game's own materials (e.g. vehicle_glass); nothing is exported for this one.">
          <Input value={def.gameMaterial ?? ''} onChange={(e) => setDef({ gameMaterial: e.target.value.trim() || null })} placeholder="(this project's material)" mono />
        </Field>
      </FieldGroup>

      <div className={styles.layers}>
        {def.layers.map((_, i) => (
          <button key={i} type="button" className={cx(styles.layerTab, i === layerIndex && styles.layerActive)} onClick={() => setLayer(i)}>
            Layer {i + 1}
          </button>
        ))}
        {def.layers.length < 4 && <IconButton icon={Plus} label="Add layer" size="sm" onClick={() => mc.addLayer(def.id)} />}
        {def.layers.length > 1 && <IconButton icon={X} label={`Remove layer ${layerIndex + 1}`} size="sm" onClick={() => mc.removeLayer(def.id, layerIndex)} />}
      </div>
      {def.paint && layerIndex === 0 && <p className={styles.hint}>Layer 1 is the paint coat: its colour previews paint slot 1, and the mask picks which paint goes where. Put the base textures on layer 2.</p>}

      <FieldGroup title="Surface">
        <Field label="Colour">
          <div className={styles.colorRow}>
            <input type="color" className={styles.color} value={hex(layer.baseColor)} onChange={(e) => set({ baseColor: [...fromHex(e.target.value), layer.baseColor[3]] })} aria-label="Base colour" />
            <span className={styles.mono}>{hex(layer.baseColor)}</span>
          </div>
        </Field>
        <SliderField label="Metallic" value={layer.metallic} onChange={(metallic) => set({ metallic })} />
        <SliderField label="Roughness" value={layer.roughness} onChange={(roughness) => set({ roughness })} />
        <SliderField label="Opacity" value={layer.opacity} onChange={(opacity) => set({ opacity })} />
        <SliderField label="Normal strength" value={layer.normalStrength} max={4} onChange={(normalStrength) => set({ normalStrength })} />
      </FieldGroup>

      <FieldGroup title="Clear coat">
        <SliderField label="Amount" value={layer.clearCoat} onChange={(clearCoat) => set({ clearCoat })} />
        <SliderField label="Roughness" value={layer.clearCoatRoughness} onChange={(clearCoatRoughness) => set({ clearCoatRoughness })} />
      </FieldGroup>

      <FieldGroup title="Glow">
        <Field label="Emissive colour">
          <input type="color" className={styles.color} value={hex(layer.emissive)} onChange={(e) => set({ emissive: fromHex(e.target.value) })} aria-label="Emissive colour" />
        </Field>
        <Field label="Brightness" hint="Nits. Lights are usually 5–50; 0 turns glow off.">
          <NumberInput value={layer.emissiveIntensity} onChange={(emissiveIntensity) => set({ emissiveIntensity })} min={0} max={100000} step={1} precision={1} unit="nits" />
        </Field>
      </FieldGroup>

      <FieldGroup title="Textures">
        {TEXTURE_SLOTS.map((slot) => (
          <TextureField key={slot} def={def} layerIndex={layerIndex} slot={slot} />
        ))}
        {layer.maps.detailNormalMap && (
          <div className={styles.row3}>
            <Field label="Detail scale U">
              <NumberInput value={layer.detailScale[0]} onChange={(u) => set({ detailScale: [u, layer.detailScale[1]] })} min={0.01} max={1024} step={1} precision={2} />
            </Field>
            <Field label="Detail scale V">
              <NumberInput value={layer.detailScale[1]} onChange={(v) => set({ detailScale: [layer.detailScale[0], v] })} min={0.01} max={1024} step={1} precision={2} />
            </Field>
            <Field label="Strength">
              <NumberInput value={layer.detailNormalStrength} onChange={(detailNormalStrength) => set({ detailNormalStrength })} min={0} max={10} step={0.05} precision={2} />
            </Field>
          </div>
        )}
        {!def.gameMaterial && <AoBakeField def={def} used={used} />}
      </FieldGroup>

      <FieldGroup title="Transparency">
        <Toggle checked={def.translucent} onChange={(translucent) => setDef({ translucent, blend: translucent && def.blend === 'None' ? 'PreMulAlpha' : def.blend })} label="Translucent (glass, lenses)" />
        {def.translucent && (
          <>
            <Field label="Blend">
              <Select value={def.blend} onChange={(blend) => setDef({ blend })} options={BLEND_OPS.map((b) => ({ value: b, label: b }))} />
            </Field>
            <Toggle checked={def.translucentZWrite} onChange={(translucentZWrite) => setDef({ translucentZWrite })} label="Write depth" />
            <Toggle checked={def.translucentRecvShadows} onChange={(translucentRecvShadows) => setDef({ translucentRecvShadows })} label="Receive shadows" />
          </>
        )}
        <Toggle checked={def.alphaTest} onChange={(alphaTest) => setDef({ alphaTest })} label="Alpha cut-out (grilles, decals)" />
        {(def.alphaTest || def.translucent) && (
          <Field label="Alpha threshold">
            <Slider value={def.alphaRef} onChange={(alphaRef) => setDef({ alphaRef: Math.round(alphaRef) })} min={0} max={255} step={1} format={(v) => String(Math.round(v))} aria-label="Alpha threshold" />
          </Field>
        )}
      </FieldGroup>

      <FieldGroup title="Rendering">
        <Field label="Sides" hint={def.backMaterialId ? 'The back faces are exported again, turned round, with the inside material: e.g. body colour outside, bare metal or carpet inside.' : undefined}>
          <Select
            value={def.backMaterialId ? `back:${def.backMaterialId}` : def.doubleSided ? 'both' : 'front'}
            onChange={(v) => setDef(v === 'front' ? { doubleSided: false, backMaterialId: null } : v === 'both' ? { doubleSided: true, backMaterialId: null } : { doubleSided: false, backMaterialId: v.slice(5) })}
            options={[
              { value: 'front', label: 'Front only' },
              { value: 'both', label: 'Both sides, same material' },
              ...others.filter((m) => m.id !== def.id).map((m) => ({ value: `back:${m.id}`, label: `Different inside: ${m.name}` })),
            ]}
            aria-label="Sides"
            data-testid="material-sides"
          />
        </Field>
        <Toggle checked={def.castShadows} onChange={(castShadows) => setDef({ castShadows })} label="Cast shadows" />
        <Toggle checked={def.dynamicCubemap} onChange={(dynamicCubemap) => setDef({ dynamicCubemap })} label="Reflect the surroundings" />
        <Toggle checked={layer.vertColor} onChange={(vertColor) => set({ vertColor })} label="Use vertex colours" />
        <Toggle checked={layer.glow} onChange={(glow) => set({ glow })} label="Glow (bloom)" />
        <Toggle checked={layer.pixelSpecular} onChange={(pixelSpecular) => set({ pixelSpecular })} label="Per-pixel specular" />
        <Toggle checked={layer.useAnisotropic} onChange={(useAnisotropic) => set({ useAnisotropic })} label="Anisotropic filtering" />
        <Toggle checked={layer.instanceDiffuse} onChange={(instanceDiffuse) => set({ instanceDiffuse })} label="Take colour from paint (older style)" />
      </FieldGroup>

      <CollapsibleSection id="material-raw" title="Raw BeamNG fields" defaultOpen={false}>
        <RawField label="Layer fields" value={layer.extra} onCommit={(extra) => set({ extra })} />
        <RawField label="Material fields" value={def.extra} onCommit={(extra) => setDef({ extra })} />
      </CollapsibleSection>
      <p className={styles.hint}>{others.length} materials in this project. The viewport preview is close to, but not the same as, BeamNG&rsquo;s renderer.</p>
    </div>
  );
}

/** Bake ambient occlusion from the car's own shape into this material's AO map. */
function AoBakeField({ def, used }: { def: MaterialDef; used: number }) {
  const busy = useAoBake((s) => s.busy);
  const progress = useAoBake((s) => s.progress);
  const [distance, setDistance] = useState(DEFAULT_AO.distance * 100);
  const [strength, setStrength] = useState(DEFAULT_AO.strength);
  const [size, setSize] = useState(String(DEFAULT_AO.size));
  const mine = busy === def.id;
  return (
    <CollapsibleSection id="material-ao-bake" title="Bake ambient occlusion" defaultOpen={false}>
      <p className={styles.hint}>Darkens creases, gaps and tucked-in areas from the car&rsquo;s own shape, as a real texture the game shows. Uses the meshes&rsquo; texture coordinates, so they shouldn&rsquo;t overlap.</p>
      <div className={styles.row3}>
        <Field label="Reach">
          <NumberInput value={distance} onChange={setDistance} min={1} max={500} step={5} precision={0} unit="cm" aria-label="Occlusion reach" />
        </Field>
        <Field label="Strength">
          <NumberInput value={strength} onChange={setStrength} min={0.1} max={2} step={0.1} precision={1} aria-label="Occlusion strength" />
        </Field>
        <Field label="Size">
          <Select value={size} onChange={setSize} options={['256', '512', '1024', '2048'].map((v) => ({ value: v, label: `${v} px` }))} aria-label="Occlusion texture size" />
        </Field>
      </div>
      <Button
        size="sm"
        disabled={!!busy || !used}
        onClick={() => void bakeAmbientOcclusion(def.id, { ...DEFAULT_AO, distance: distance / 100, strength, size: Number(size) })}
        data-testid="material-bake-ao"
      >
        {mine ? `Baking… ${Math.round(progress * 100)}%` : used ? 'Bake' : 'Bake (not on any mesh yet)'}
      </Button>
    </CollapsibleSection>
  );
}

function NameField({ def }: { def: MaterialDef }) {
  const [draft, setDraft] = useState(def.name);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = () => {
    if (draft === def.name) return;
    const err = mc.renameMaterial(def.id, draft);
    setProblem(err);
    if (err) setDraft(def.name);
  };
  return (
    <Field label="Name" hint={problem ?? (def.origin ? `Imported from ${def.origin.name}` : 'Exported with your mod prefix in front.')}>
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} mono data-testid="material-name" />
    </Field>
  );
}

function SliderField({ label, value, onChange, max = 1 }: { label: string; value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <Field label={label}>
      <div className={styles.sliderRow}>
        <Slider value={value} onChange={onChange} min={0} max={max} step={0.01} format={(v) => v.toFixed(2)} aria-label={label} />
        <NumberInput value={value} onChange={onChange} min={0} max={max} step={0.05} precision={2} aria-label={`${label} value`} className={styles.num} />
      </div>
    </Field>
  );
}

function TextureField({ def, layerIndex, slot }: { def: MaterialDef; layerIndex: number; slot: TextureSlot }) {
  const layer = def.layers[layerIndex]!;
  const path = layer.maps[slot];
  const uv2 = layer.uv2.includes(slot);
  return (
    <div className={styles.texture}>
      <span className={styles.textureLabel}>{SLOT_LABELS[slot]}</span>
      <span className={cx(styles.textureFile, !path && styles.none)} title={path}>
        {path ? fileName(path) : 'none'}
      </span>
      {path && (
        <button type="button" className={cx(styles.uv, uv2 && styles.uvOn)} onClick={() => mc.updateLayer(def.id, layerIndex, { uv2: uv2 ? layer.uv2.filter((s) => s !== slot) : [...layer.uv2, slot] })} title="Read the second UV channel">
          UV2
        </button>
      )}
      <IconButton icon={FolderOpen} label="Choose file" size="sm" onClick={() => void mc.pickTexture(def.id, layerIndex, slot)} />
      {path && <IconButton icon={X} label="Clear" size="sm" onClick={() => mc.setTexture(def.id, layerIndex, slot, null)} />}
    </div>
  );
}

function RawField({ label, value, onCommit }: { label: string; value: Record<string, unknown>; onCommit: (v: Record<string, unknown>) => void }) {
  const text = Object.keys(value).length ? JSON.stringify(value, null, 2) : '';
  const [draft, setDraft] = useState(text);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = () => {
    if (draft === text) return;
    try {
      const parsed: unknown = draft.trim() ? JSON.parse(draft) : {};
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Needs to be a JSON object: { "field": value }');
      setProblem(null);
      onCommit(parsed as Record<string, unknown>);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Field label={label} hint={problem ?? 'Merged over what the editor writes, for anything BeamNG supports that isn’t above.'}>
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} rows={4} className={styles.mono} placeholder='{ "annotation": "CAR_PAINT" }' />
    </Field>
  );
}
