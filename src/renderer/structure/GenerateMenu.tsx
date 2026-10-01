import { useState } from 'react';
import { ChevronDown, Wand2 } from 'lucide-react';
import type { Settings } from '@shared/settings-schema';
import { call } from '@renderer/diagnostics/ipc';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { Button } from '@renderer/ui/components/Button';
import { Field } from '@renderer/ui/components/Field';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Popover } from '@renderer/ui/components/Popover';
import { Select } from '@renderer/ui/components/Select';
import { generateAll } from './generate';
import styles from './GenerateMenu.module.css';

/**
 * Generate, with its options beside it: the proxy mode every part is built
 * with (or each part's own) and the general detail. Remembered in Settings.
 */

type Mode = Settings['generateMode'];

export const GENERATE_MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Best for each part (recommended)', hint: 'A convex hull for every part, and the body shell following its surface (a hull would bridge its wheel arches). Anything you set on a part in the Inspector is kept.' },
  { value: 'hull', label: 'Convex hull, body included', hint: 'Wraps every part like shrink-wrap, the body too: robust and well braced. Hollows (wheel arches, window recesses) are bridged.' },
  { value: 'surface', label: 'Follow the surface', hint: 'Nodes spread evenly over the mesh: follows curves and hollows, needs a clean model.' },
  { value: 'decimate', label: 'Simplified mesh', hint: 'The model itself, simplified: keeps its outline, can be uneven.' },
  { value: 'box', label: 'Boxes', hint: 'A box per part: the simplest, for a quick test.' },
];

const DETAILS = [
  { value: '0', label: 'Very low' },
  { value: '0.25', label: 'Low' },
  { value: '0.5', label: 'Medium' },
  { value: '0.75', label: 'High' },
  { value: '1', label: 'Very high' },
] as const;

const nearestDetail = (d: number) => DETAILS.reduce((best, x) => (Math.abs(Number(x.value) - d) < Math.abs(Number(best.value) - d) ? x : best)).value;

export function GenerateMenu({ disabled, label }: { disabled: boolean; label: string }) {
  const settings = useSettingsStore((s) => s.settings);
  const [open, setOpen] = useState(false);
  const mode: Mode = settings?.generateMode ?? 'auto';
  const detail = settings?.generateDetail ?? 0.5;
  const run = () => void generateAll({ mode, detail });
  const save = (patch: Partial<Pick<Settings, 'generateMode' | 'generateDetail'>>) => void call('settings:update', patch).catch(() => undefined);
  return (
    <>
      <IconButton icon={Wand2} label={label} disabled={disabled} onClick={run} data-testid="toolbar-generate" />
      <Popover
        open={open}
        onOpenChange={setOpen}
        title="Generate structure"
        trigger={<IconButton icon={ChevronDown} size="sm" label="How to generate: proxy mode and detail" disabled={disabled} data-testid="toolbar-generate-options" />}
      >
        <div className={styles.menu} data-testid="generate-menu">
          <Field label="Proxy mode" hint={GENERATE_MODES.find((m) => m.value === mode)?.hint}>
            <Select<Mode> aria-label="Proxy mode" value={mode} onChange={(generateMode) => save({ generateMode })} options={GENERATE_MODES} data-testid="generate-mode" />
          </Field>
          <Field label="Detail" hint="How many nodes each part gets, within what suits its kind. More follows the shape closer; fewer is lighter and steadier.">
            <Select aria-label="Detail" value={nearestDetail(detail)} onChange={(v) => save({ generateDetail: Number(v) })} options={DETAILS} data-testid="generate-detail" />
          </Field>
          <Button
            variant="primary"
            icon={Wand2}
            onClick={() => {
              setOpen(false);
              run();
            }}
            data-testid="generate-go"
          >
            Generate all parts
          </Button>
        </div>
      </Popover>
    </>
  );
}
