import { Eye, EyeOff, Trash2, Video } from 'lucide-react';
import { EMPTY_ARR } from '@shared/empty';
import { CAMERA_TYPES } from '@shared/cameras/cameras';
import { useProjectStore } from '@renderer/app/stores/project';
import { useEditStore } from '@renderer/structure/editStore';
import { Button } from '@renderer/ui/components/Button';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { addCamera, removeCamera, updateCamera, useCameraUi } from './commands';
import styles from '@renderer/features/FeaturesPanel.module.css';

/** Interior cameras: the driver's eyes (and more), placed and tried in the viewport. */
export function CamerasSection() {
  const cameras = useProjectStore((s) => s.doc?.cameras ?? EMPTY_ARR);
  const look = useCameraUi((s) => s.look);
  const nodes = useEditStore((s) => s.nodes);
  const nodePos = useProjectStore((s) => (nodes.length === 1 ? s.doc?.nodes.find((n) => n.id === nodes[0])?.pos : undefined));
  return (
    <FieldGroup title="Interior cameras">
      <p className={styles.note}>The driver&rsquo;s view in the game: the camera hangs off the body&rsquo;s nodes around it, so it leans and shakes with the car. Needs the body&rsquo;s structure.</p>
      {cameras.map((c) => {
        const looking = !!look && look.pos.every((v, i) => Math.abs(v - c.pos[i]!) < 1e-9);
        return (
          <div key={c.id} className={styles.card} data-testid="camera-card">
            <Field label="Type" hint="The game's camera name: driver is the interior view">
              <Input value={c.type} onChange={(e) => e.target.value.trim() && updateCamera(c.id, { type: e.target.value.trim() }, 'Rename camera')} list="camera-types" mono aria-label="Camera type" />
            </Field>
            <Field label="Eye position (m)" hint="Left–right (+ is left) · front–back (− is forward) · height">
              <div className={styles.xyz}>
                {[0, 1, 2].map((i) => (
                  <NumberInput key={i} value={c.pos[i]!} onChange={(v) => updateCamera(c.id, { pos: c.pos.map((p, j) => (j === i ? v : p)) as [number, number, number] })} step={0.01} precision={3} unit={'XYZ'[i]} aria-label={`Camera ${'XYZ'[i]}`} />
                ))}
              </div>
            </Field>
            <Field label="Field of view">
              <Slider value={c.fov} onChange={(fov) => updateCamera(c.id, { fov }, 'Camera field of view')} min={30} max={110} step={1} format={(v) => `${Math.round(v)}°`} aria-label="Field of view" />
            </Field>
            <div className={styles.row}>
              <Button size="sm" icon={looking ? EyeOff : Eye} variant={looking ? 'primary' : 'default'} onClick={() => useCameraUi.getState().setLook(looking ? null : { pos: c.pos, fov: c.fov })} data-testid="camera-look">
                {looking ? 'Back to orbit' : 'Look through it'}
              </Button>
              {nodePos && (
                <Button size="sm" variant="ghost" onClick={() => updateCamera(c.id, { pos: [...nodePos] as [number, number, number] }, 'Camera at node')}>
                  At selected node
                </Button>
              )}
              <Button size="sm" icon={Trash2} variant="ghost" onClick={() => removeCamera(c.id)} aria-label="Remove camera" />
            </div>
          </div>
        );
      })}
      <datalist id="camera-types">
        {CAMERA_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className={styles.row}>
        <Select value={undefined} onChange={(v) => addCamera(v === 'driver-rhd' ? 'driver' : v, v === 'driver-rhd')} options={[
          { value: 'driver', label: 'Driver (left-hand drive)' },
          { value: 'driver-rhd', label: 'Driver (right-hand drive)' },
          { value: 'passenger', label: 'Passenger' },
          { value: 'hood', label: 'Hood' },
        ]} placeholder="Add a camera…" aria-label="Add a camera" data-testid="camera-add" />
        <Video aria-hidden className={styles.icon} />
      </div>
    </FieldGroup>
  );
}
