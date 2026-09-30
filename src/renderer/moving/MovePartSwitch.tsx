import { Toggle } from '@renderer/ui/components/Toggle';
import { usePreviewStyle } from '@renderer/hinges/commands';

/** Preview moving parts with a see-through copy, or by moving the part itself. */
export function MovePartSwitch() {
  const real = usePreviewStyle((s) => s.real);
  return <Toggle checked={real} onChange={(v) => usePreviewStyle.getState().setReal(v)} label="Move the part itself (not a see-through copy)" />;
}
