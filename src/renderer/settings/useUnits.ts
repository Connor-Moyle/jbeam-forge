import { useMemo } from 'react';
import { formatUnits } from '@shared/units';
import { useSettingsStore } from '@renderer/app/stores/settings';

/** Formatters in the units chosen in Settings → Units. */
export function useUnits() {
  const power = useSettingsStore((s) => s.settings?.powerUnit ?? 'hp');
  const torque = useSettingsStore((s) => s.settings?.torqueUnit ?? 'nm');
  const speed = useSettingsStore((s) => s.settings?.speedUnit ?? 'kmh');
  return useMemo(() => formatUnits({ power, torque, speed }), [power, torque, speed]);
}
