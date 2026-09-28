import { CamerasSection } from '@renderer/cameras/CamerasSection';
import { useState } from 'react';
import { Eye, EyeOff, FolderOpen, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Features } from '@shared/project/schema';
import { N2O_SHOTS_KW } from '@shared/export/features';
import { EMPTY_ARR } from '@shared/empty';
import { useProjectStore } from '@renderer/app/stores/project';
import { useTaxonomy } from '@renderer/parts/taxonomy';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Input } from '@renderer/ui/components/Input';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Toggle } from '@renderer/ui/components/Toggle';
import { addSkin, deleteSkin, LABELS, pickSkinTexture, renameSkin, setNitrous, setSkinOverride, toggleFeature, updateMount, useFeatureUi } from './commands';
import styles from './FeaturesPanel.module.css';

type Mounted = keyof typeof LABELS;
type Vec3 = [number, number, number];

const hex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

function mountOf(f: Features, kind: Mounted) {
  return kind === 'plateFront' ? f.plates.front : kind === 'plateRear' ? f.plates.rear : kind === 'hitch' ? f.hitch : f.nitrous;
}

/**
 * Extras the game gives every car: licence plates, a tow hitch, nitrous, and
 * paint designs (the Paint Design menu in game).
 */
export function FeaturesPanel() {
  const doc = useProjectStore((s) => s.doc);
  const materials = useProjectStore((s) => s.doc?.materials ?? EMPTY_ARR);
  const preview = useFeatureUi((s) => s.preview);
  const [message, setMessage] = useState<string | null>(null);
  const [skinId, setSkinId] = useState<string | null>(null);
  const tax = useTaxonomy();
  if (!doc) return null;
  const f = doc.features;
  const withStructure = doc.parts.filter((p) => tax.entry(p.taxonomyId) && doc.nodes.some((n) => n.partId === p.id));
  const partOptions = withStructure.map((p) => ({ value: p.id, label: p.displayName }));
  const skin = f.skins.find((s) => s.id === skinId) ?? f.skins[0] ?? null;
  const usedMaterials = materials.filter((m) => !m.gameMaterial);

  const toggle = (kind: Mounted, on: boolean) => {
    const ok = toggleFeature(kind, on);
    setMessage(ok ? null : `Generate the structure first: the ${LABELS[kind].toLowerCase()} fixes to the car's nodes.`);
  };

  const mountFields = (kind: Mounted) => {
    const m = mountOf(f, kind);
    if (!m) return null;
    const tilt = kind === 'plateFront' ? f.plates.front!.tilt : kind === 'plateRear' ? f.plates.rear!.tilt : null;
    const setPos = (i: number, v: number) => updateMount(kind, { pos: m.pos.map((x, j) => (j === i ? v : x)) as Vec3 });
    return (
      <>
        <Field label="Fixed to">
          <Select value={m.partId} onChange={(partId) => updateMount(kind, { partId })} options={partOptions.some((o) => o.value === m.partId) ? partOptions : [{ value: m.partId, label: '(removed part)' }, ...partOptions]} aria-label={`${LABELS[kind]} part`} />
        </Field>
        <Field label="Position (m)" hint="Left–right · front–back (− is forward) · height">
          <div className={styles.xyz}>
            {(['X', 'Y', 'Z'] as const).map((axis, i) => (
              <NumberInput key={axis} value={m.pos[i]!} onChange={(v) => setPos(i, v)} step={0.005} precision={3} aria-label={`${LABELS[kind]} ${axis}`} />
            ))}
            <IconButton icon={RotateCcw} size="sm" label="Put back where it usually goes" onClick={() => toggle(kind, true)} />
          </div>
        </Field>
        {tilt !== null && (
          <Field label="Tilt">
            <Slider value={tilt} onChange={(tilt) => updateMount(kind, { tilt })} min={-30} max={30} step={1} format={(x) => `${x.toFixed(0)}°`} aria-label={`${LABELS[kind]} tilt`} />
          </Field>
        )}
      </>
    );
  };

  const section = (kind: Mounted, hint: string) => (
    <div className={styles.feature} data-testid={`feature-${kind}`}>
      <Toggle checked={!!mountOf(f, kind)} onChange={(on) => toggle(kind, on)} label={LABELS[kind]} aria-label={LABELS[kind]} />
      {mountOf(f, kind) ? mountFields(kind) : <p className={styles.note}>{hint}</p>}
    </div>
  );

  return (
    <div className={styles.panel} data-testid="features-panel">
      <div className={styles.head}>
        <Button icon={preview ? Eye : EyeOff} size="sm" variant={preview ? 'primary' : 'ghost'} onClick={() => useFeatureUi.getState().setPreview(!preview)}>
          {preview ? 'Showing in viewport' : 'Show in viewport'}
        </Button>
      </div>
      {message && <Callout tone="warning">{message}</Callout>}
      <ScrollArea className={styles.scroll}>
        <FieldGroup title="Licence plates">
          {section('plateFront', 'The game’s plate, with the player’s own text and design, on the front bumper.')}
          {section('plateRear', 'The same on the back.')}
        </FieldGroup>

        <FieldGroup title="Towing">
          {section('hitch', 'A tow ball behind the rear bumper that trailers couple to.')}
        </FieldGroup>

        <FieldGroup title="Nitrous">
          {section('nitrous', 'A nitrous bottle in the boot, sprayed into the engine above a set rev and gear (both adjustable in game).')}
          {f.nitrous && (
            <>
              <Field label="Bottle">
                <Select value={f.nitrous.bottle} onChange={(bottle) => setNitrous({ bottle: bottle })} options={[{ value: '10lb', label: '10 lb' }, { value: '20lb', label: '20 lb' }]} aria-label="Nitrous bottle" />
              </Field>
              <Field label="Shot" hint="Players can change it in game">
                <Select value={String(f.nitrous.shotKw)} onChange={(v) => setNitrous({ shotKw: Number(v) })} options={N2O_SHOTS_KW.map((kw) => ({ value: String(kw), label: `${kw} kW` }))} aria-label="Nitrous shot" />
              </Field>
              {!doc.powertrain.engine && <Callout tone="warning">Nitrous feeds the engine: fit one in the engine workshop, or it’s left out of the export.</Callout>}
            </>
          )}
        </FieldGroup>

        <FieldGroup title="Paint designs">
          <div className={styles.feature}>
            <div className={styles.head}>
              {f.skins.length > 0 && (
                <Select value={skin?.id ?? ''} onChange={setSkinId} options={f.skins.map((s) => ({ value: s.id, label: s.name }))} aria-label="Paint design" className={styles.grow} />
              )}
              <Button icon={Plus} size="sm" onClick={() => setSkinId(addSkin())} data-testid="skin-add">
                New design
              </Button>
              {skin && <IconButton icon={Trash2} size="sm" label="Delete design" onClick={() => deleteSkin(skin.id)} />}
            </div>
            {skin ? (
              <>
                <Field label="Name" hint="In the game’s Paint Design menu">
                  <Input value={skin.name} onChange={(e) => renameSkin(skin.id, e.target.value)} data-testid="skin-name" />
                </Field>
                <ul className={styles.materials} data-testid="skin-materials">
                  {usedMaterials.map((m) => {
                    const o = skin.overrides[m.id];
                    const base = m.layers[0]!;
                    return (
                      <li key={m.id} className={styles.material}>
                        <span className={styles.materialName}>{m.name}</span>
                        <input type="color" className={styles.color} value={hex(o?.baseColor ?? base.baseColor)} onChange={(e) => setSkinOverride(skin.id, m.id, { baseColor: [...fromHex(e.target.value), (o?.baseColor ?? base.baseColor)[3]] })} aria-label={`${m.name} colour in ${skin.name}`} />
                        <IconButton icon={FolderOpen} size="sm" label={o?.baseColorMap ? `Texture: ${o.baseColorMap}` : 'Use a texture'} active={!!o?.baseColorMap} onClick={() => void pickSkinTexture(skin.id, m.id)} />
                        <IconButton icon={RotateCcw} size="sm" label="Keep the material as it is" disabled={!o} onClick={() => setSkinOverride(skin.id, m.id, { baseColor: null, baseColorMap: null })} />
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className={styles.note}>A design recolours or re-textures some materials: a livery, a race number, a two-tone. Players pick it under Paint Design.</p>
            )}
          </div>
        </FieldGroup>
        <CamerasSection />
      </ScrollArea>
    </div>
  );
}
