import { Box, Eye, MousePointer2, ScanLine } from 'lucide-react';
import { keyFor } from '@renderer/app/keys';
import { useProjectStore } from '@renderer/app/stores/project';
import { useUiStore } from '@renderer/app/stores/ui';
import { useEditStore } from '@renderer/structure/editStore';
import { cx } from '@renderer/ui/cx';
import { iconSize } from '@renderer/ui/tokens';
import { IconButton } from '@renderer/ui/components/IconButton';
import { Select } from '@renderer/ui/components/Select';
import { Tooltip } from '@renderer/ui/components/Tooltip';
import { CHANNELS, type Channel } from './channels';
import styles from './ViewportHeader.module.css';

/**
 * The strip along the top of the 3D view: what you're doing in it on the left
 * (picking meshes, or editing nodes and beams), what it draws on the right.
 */
export function ViewportHeader() {
  const view = useUiStore((s) => s.view);
  const toggleView = useUiStore((s) => s.toggleView);
  const channel = useUiStore((s) => s.channel);
  const setChannel = useUiStore((s) => s.setChannel);
  const hasStructure = useProjectStore((s) => (s.doc?.nodes.length ?? 0) > 0);
  const editing = useEditStore((s) => s.active);
  const setEditing = useEditStore((s) => s.setActive);
  const editHint = editing ? 'Stop editing nodes & beams' : hasStructure ? 'Edit nodes & beams' : 'Edit nodes & beams (generate the structure first)';

  return (
    <div className={styles.header} role="group" aria-label="3D view">
      <Tooltip content={editHint} shortcut={keyFor('editMode')} side="bottom">
        <button
          type="button"
          className={cx(styles.mode, editing && styles.modeOn)}
          aria-label={editHint}
          aria-pressed={editing}
          disabled={!hasStructure && !editing}
          onClick={() => setEditing(!editing)}
          data-testid="toolbar-edit"
        >
          <MousePointer2 size={iconSize('size-icon-sm')} aria-hidden />
          {editing ? 'Editing nodes' : 'Edit nodes'}
        </button>
      </Tooltip>
      <span className={styles.spacer} />
      <span className={styles.label}>Show</span>
      <IconButton icon={Eye} size="sm" tooltipSide="bottom" label={view.mesh ? 'Hide mesh' : 'Show mesh'} shortcut={keyFor('viewMesh')} active={view.mesh} onClick={() => toggleView('mesh')} data-testid="toolbar-view-mesh" />
      <IconButton
        icon={Box}
        size="sm"
        tooltipSide="bottom"
        label={view.structure ? 'Hide nodes & beams' : 'Show nodes & beams'}
        shortcut={keyFor('viewStructure')}
        active={view.structure}
        onClick={() => toggleView('structure')}
        data-testid="toolbar-view-structure"
      />
      <IconButton icon={ScanLine} size="sm" tooltipSide="bottom" label={view.xray ? 'X-ray off' : 'X-ray: see through the mesh'} shortcut={keyFor('viewXray')} active={view.xray} onClick={() => toggleView('xray')} data-testid="toolbar-view-xray" />
      <Select<Channel> aria-label="Material channel view" value={channel} onChange={setChannel} options={CHANNELS} className={styles.channel} data-testid="toolbar-channel" />
    </div>
  );
}
