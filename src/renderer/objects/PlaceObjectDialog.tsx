import { addObject } from '@renderer/panels/ObjectsPanel';
import { Button } from '@renderer/ui/components/Button';
import { Modal } from '@renderer/ui/components/Modal';
import { cornerKind, placeAtCorner, usePlaceUi, type CornerChoice } from './placeObject';
import styles from './PlaceObjectDialog.module.css';

const CHOICES: { value: CornerChoice; label: string }[] = [
  { value: 'FL', label: 'Front left' },
  { value: 'FR', label: 'Front right' },
  { value: 'RL', label: 'Rear left' },
  { value: 'RR', label: 'Rear right' },
];

/** "Where does it go?" for objects that sit at a wheel. */
export function PlaceObjectDialog() {
  const item = usePlaceUi((s) => s.item);
  if (!item) return null;
  const close = () => usePlaceUi.getState().ask(null);
  const choose = async (choice: CornerChoice) => {
    close();
    const sourceId = await addObject(item, false, choice === 'unsure');
    if (sourceId) placeAtCorner(sourceId, choice, cornerKind(item));
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={`Where does ${item.name} go?`}
      description="It’s put at that wheel. Front and rear follow BeamNG: left is the driver’s left."
      size="sm"
      footer={<Button onClick={close}>Cancel</Button>}
    >
      <div className={styles.grid} data-testid="place-object">
        {CHOICES.map((c) => (
          <Button key={c.value} onClick={() => void choose(c.value)} data-testid={`place-${c.value}`}>
            {c.label}
          </Button>
        ))}
        <Button variant="primary" className={styles.wide} onClick={() => void choose('all')} data-testid="place-all">
          All four corners
        </Button>
        <Button variant="ghost" className={styles.wide} onClick={() => void choose('unsure')} data-testid="place-unsure">
          Not sure: I’ll place it myself
        </Button>
      </div>
    </Modal>
  );
}
