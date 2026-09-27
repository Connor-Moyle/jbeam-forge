import { Copy, FlipHorizontal2, Palette, RotateCcw, Trash2 } from 'lucide-react';
import { useProjectStore } from '@renderer/app/stores/project';
import { useOptionalShell } from '@renderer/shell/ShellContext';
import { updateLayer, useMaterialUi } from '@renderer/materials/commands';
import { slotsOf } from '@renderer/materials/seed';
import { Button } from '@renderer/ui/components/Button';
import { CollapsibleSection } from '@renderer/ui/components/CollapsibleSection';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Slider } from '@renderer/ui/components/Slider';
import { IDENTITY_EDIT } from '@shared/mesh/meshEdit';
import type { MeshEdit } from '@shared/project/schema';
import { deleteCopies, duplicateMeshes, mirrorCopy, resetMeshEdit, setMeshEdit } from './meshCommands';
import styles from './MeshSection.module.css';

const AXES = ['X', 'Y', 'Z'] as const;
const hex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

/**
 * The selected meshes: where they sit (move, turn, resize), a mirrored copy
 * for the other side, how their textures map, and their material's main
 * settings. Values shown are the last selected mesh's; changes apply to all.
 */
export function MeshSection({ keys }: { keys: readonly string[] }) {
  const last = keys[keys.length - 1]!;
  const edit = useProjectStore((s): MeshEdit => s.doc?.meshEdits[last] ?? IDENTITY_EDIT);
  const materialId = useProjectStore((s) => (s.doc ? slotsOf(s.doc, last)?.[0] : undefined));
  const material = useProjectStore((s) => s.doc?.materials.find((m) => m.id === materialId));
  const shell = useOptionalShell();
  const copies = keys.filter((k) => k.startsWith('copy:'));
  const count = keys.length === 1 ? 'this mesh' : `these ${keys.length} meshes`;

  const vec = (field: 'position' | 'rotation' | 'scale', i: number, v: number) => {
    const next = [...edit[field]] as [number, number, number];
    next[i] = v;
    setMeshEdit(keys, { [field]: next }, field === 'position' ? 'Move mesh' : field === 'rotation' ? 'Turn mesh' : 'Resize mesh');
  };
  const uniform = (v: number) => setMeshEdit(keys, { scale: [v, v, v] }, 'Resize mesh');
  const uv = (patch: Partial<MeshEdit['uv']>, label: string) => setMeshEdit(keys, { uv: patch }, label);
  const layer = material?.layers.find((l) => l.maps.baseColorMap) ?? material?.layers[0];
  const layerIndex = material && layer ? material.layers.indexOf(layer) : 0;

  return (
    <FieldGroup title={keys.length === 1 ? 'Mesh' : `${keys.length} meshes`}>
      <Field label="Position (m)" hint="Moves it from where it was imported. BeamNG axes: +X left, +Y rearward, +Z up. Or drag the arrows in the viewport.">
        <div className={styles.triple}>
          {AXES.map((a, i) => (
            <NumberInput key={a} aria-label={`Mesh position ${a}`} value={edit.position[i]!} step={0.005} precision={3} unit={a} onChange={(v) => vec('position', i, v)} />
          ))}
        </div>
      </Field>
      <Field label="Rotation (°)" hint="Turns it about its own centre.">
        <div className={styles.triple}>
          {AXES.map((a, i) => (
            <NumberInput key={a} aria-label={`Mesh rotation ${a}`} value={edit.rotation[i]!} step={5} precision={1} min={-360} max={360} unit={a} onChange={(v) => vec('rotation', i, v)} />
          ))}
        </div>
      </Field>
      <Field label="Scale">
        <div className={styles.quad}>
          {AXES.map((a, i) => (
            <NumberInput key={a} aria-label={`Mesh scale ${a}`} value={edit.scale[i]!} step={0.05} precision={3} min={0.001} max={1000} unit={a} onChange={(v) => vec('scale', i, v)} />
          ))}
          <NumberInput aria-label="Mesh scale, all axes" value={edit.scale[0]} step={0.05} precision={3} min={0.001} max={1000} unit="all" onChange={uniform} />
        </div>
      </Field>
      <div className={styles.actions}>
        <Button icon={FlipHorizontal2} size="sm" onClick={() => mirrorCopy(keys)} data-testid="mesh-mirror">
          Mirror to other side
        </Button>
        <Button icon={Copy} size="sm" variant="ghost" onClick={() => duplicateMeshes(keys)}>
          Duplicate
        </Button>
        <Button icon={RotateCcw} size="sm" variant="ghost" onClick={() => resetMeshEdit(keys)}>
          Reset
        </Button>
        {copies.length > 0 && (
          <Button icon={Trash2} size="sm" variant="ghost" onClick={() => deleteCopies(copies)}>
            Delete copy
          </Button>
        )}
      </div>

      <CollapsibleSection id="mesh-texture" title="Texture mapping" defaultOpen={false}>
        <p className={styles.note}>Just {count}: other parts using the same material keep theirs. Baked into the exported mesh.</p>
        <Field label="Scale (tiling)">
          <div className={styles.pair}>
            <NumberInput aria-label="Texture scale U" value={edit.uv.scale[0]} step={0.1} precision={2} min={0.01} max={1000} unit="U" onChange={(v) => uv({ scale: [v, edit.uv.scale[1]] }, 'Scale texture')} />
            <NumberInput aria-label="Texture scale V" value={edit.uv.scale[1]} step={0.1} precision={2} min={0.01} max={1000} unit="V" onChange={(v) => uv({ scale: [edit.uv.scale[0], v] }, 'Scale texture')} />
          </div>
        </Field>
        <Field label="Offset">
          <div className={styles.pair}>
            <NumberInput aria-label="Texture offset U" value={edit.uv.offset[0]} step={0.05} precision={3} unit="U" onChange={(v) => uv({ offset: [v, edit.uv.offset[1]] }, 'Move texture')} />
            <NumberInput aria-label="Texture offset V" value={edit.uv.offset[1]} step={0.05} precision={3} unit="V" onChange={(v) => uv({ offset: [edit.uv.offset[0], v] }, 'Move texture')} />
          </div>
        </Field>
        <Field label="Rotation">
          <Slider value={edit.uv.rotation} onChange={(rotation) => uv({ rotation }, 'Turn texture')} min={-180} max={180} step={1} format={(v) => `${v}°`} aria-label="Texture rotation" />
        </Field>
      </CollapsibleSection>

      {material && layer && (
        <CollapsibleSection id="mesh-material" title={`Material: ${material.name}`} defaultOpen>
          {material.gameMaterial ? (
            <p className={styles.note}>Uses the game&rsquo;s own material &ldquo;{material.gameMaterial}&rdquo;, so it looks right in BeamNG. Clear that in the full editor to make it your own.</p>
          ) : (
            <>
              <Field label="Colour">
                <input type="color" className={styles.color} value={hex(layer.baseColor)} onChange={(e) => updateLayer(material.id, layerIndex, { baseColor: [...fromHex(e.target.value), layer.baseColor[3]] })} aria-label="Material colour" />
              </Field>
              <Field label="Metallic">
                <Slider value={layer.metallic} onChange={(metallic) => updateLayer(material.id, layerIndex, { metallic })} min={0} max={1} step={0.01} aria-label="Metallic" />
              </Field>
              <Field label="Roughness">
                <Slider value={layer.roughness} onChange={(roughness) => updateLayer(material.id, layerIndex, { roughness })} min={0} max={1} step={0.01} aria-label="Roughness" />
              </Field>
              <Field label="Clear coat">
                <Slider value={layer.clearCoat} onChange={(clearCoat) => updateLayer(material.id, layerIndex, { clearCoat })} min={0} max={1} step={0.01} aria-label="Clear coat" />
              </Field>
            </>
          )}
          <Button
            icon={Palette}
            size="sm"
            onClick={() => {
              useMaterialUi.getState().select(material.id);
              shell?.showPanel('materials');
            }}
            data-testid="mesh-edit-material"
          >
            All material settings…
          </Button>
        </CollapsibleSection>
      )}
    </FieldGroup>
  );
}
