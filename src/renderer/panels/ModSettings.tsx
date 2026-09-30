import { RefreshCw } from 'lucide-react';
import { projectStore, useProjectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { reloadSource } from '@renderer/import/importFlow';
import { Button } from '@renderer/ui/components/Button';
import { FieldGroup } from '@renderer/ui/components/Field';
import { Toggle } from '@renderer/ui/components/Toggle';
import type { ProjectMeta } from '@shared/project/schema';
import { PortedFromFields } from './PortedFromFields';
import styles from './InspectorPanel.module.css';

/**
 * The Inspector with nothing picked (fork): this mod's own options. Each
 * starts from Settings (Files, Export) and can differ per mod.
 */
export function ModSettings() {
  const meta = useProjectStore((s) => s.doc?.meta);
  const sources = useProjectStore((s) => s.doc?.sources.length ?? 0);
  const settings = useSettingsStore((s) => s.settings);
  if (!meta) return null;
  const set = (patch: Partial<Pick<ProjectMeta, 'autoReimport' | 'ddsConvert'>>, label: string) => projectStore.getState().execute({ label, apply: (d) => void Object.assign(d.meta, patch) });
  const reimport = meta.autoReimport ?? settings?.autoReimport ?? true;
  const dds = meta.ddsConvert ?? settings?.ddsConvert ?? false;
  return (
    <FieldGroup title={`This mod: ${meta.name}`}>
      <p className={styles.meshNote}>Nothing is picked. Select a part, node or beam to edit it; these are options for the whole mod.</p>
      <Toggle checked={reimport} onChange={(autoReimport) => set({ autoReimport }, autoReimport ? 'Reload models when they change' : 'Stop reloading changed models')} label="Reload the model when its file changes" />
      <Toggle checked={dds} onChange={(ddsConvert) => set({ ddsConvert }, ddsConvert ? 'Export textures as DDS' : 'Export textures as they are')} label="Convert textures to DDS when exporting" />
      {sources > 0 && (
        <Button
          size="sm"
          icon={RefreshCw}
          onClick={() => {
            for (const s of projectStore.getState().doc?.sources ?? []) void reloadSource(s.id);
          }}
          data-testid="reload-models"
        >
          Reload the model{sources === 1 ? '' : 's'} now
        </Button>
      )}
      <PortedFromFields value={meta.portedFrom} />
    </FieldGroup>
  );
}
