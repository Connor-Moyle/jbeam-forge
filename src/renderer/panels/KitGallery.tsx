import { useState, type ReactNode } from 'react';
import { Box, Copy, Eye, FolderTree, Inbox, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  CollapsibleSection,
  EmptyState,
  IconButton,
  Input,
  Modal,
  NumberInput,
  Popover,
  ScrollArea,
  Select,
  Slider,
  TabPanel,
  Tabs,
  Toggle,
  Tooltip,
  TreeRow,
} from '@renderer/ui';
import { useUiStore } from '@renderer/app/stores/ui';
import styles from './KitGallery.module.css';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.rowItems}>{children}</div>
    </div>
  );
}

const MATERIAL_OPTIONS = [
  { value: 'steel', label: 'Steel' },
  { value: 'aluminium', label: 'Aluminium' },
  { value: 'carbon', label: 'Carbon fibre' },
  { value: 'plastic', label: 'Plastic', disabled: true },
] as const;

type Material = (typeof MATERIAL_OPTIONS)[number]['value'];

/** Every kit component in every state — the visual contract checked by run-desktop screenshots. */
export function KitGalleryPanel() {
  const [checked, setChecked] = useState(true);
  const [toggle, setToggle] = useState(true);
  const [slider, setSlider] = useState(0.4);
  const [num, setNum] = useState(12.5);
  const [material, setMaterial] = useState<Material>('steel');
  const [tab, setTab] = useState('general');
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState('door_FL');
  const [expanded, setExpanded] = useState(true);
  const pushStatus = useUiStore((s) => s.pushStatus);

  return (
    <ScrollArea className={styles.gallery} data-testid="kit-gallery">
      <CollapsibleSection id="kit.buttons" title="Buttons">
        <Row label="Variants">
          <Button>Default</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon={Trash2}>
            Delete
          </Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" icon={Plus}>
            Small
          </Button>
        </Row>
        <Row label="Icon">
          <IconButton icon={Pencil} label="Edit" shortcut="E" />
          <IconButton icon={Eye} label="Visibility" active />
          <IconButton icon={Copy} label="Duplicate" size="sm" />
          <IconButton icon={Trash2} label="Delete" disabled />
        </Row>
      </CollapsibleSection>

      <CollapsibleSection id="kit.inputs" title="Inputs" actions={<Badge tone="accent">6</Badge>}>
        <Row label="Text">
          <Input placeholder="Vehicle name" aria-label="Vehicle name" />
          <Input defaultValue="dl4r" mono aria-label="Node id" />
          <Input defaultValue="Bad Slug" invalid aria-label="Slug" />
        </Row>
        <Row label="Number">
          <NumberInput value={num} onChange={setNum} unit="kg" aria-label="Mass" />
          <NumberInput value={3} onChange={() => undefined} precision={0} disabled aria-label="Disabled count" />
        </Row>
        <Row label="Select">
          <Select value={material} onChange={setMaterial} options={MATERIAL_OPTIONS} aria-label="Material" />
        </Row>
        <Row label="Check / toggle">
          <Checkbox checked={checked} onChange={setChecked} label="Symmetry" />
          <Checkbox checked="indeterminate" onChange={() => undefined} label="Mixed" />
          <Toggle checked={toggle} onChange={setToggle} label="Snap to grid" />
          <Toggle checked={false} onChange={() => undefined} label="Disabled" disabled />
        </Row>
        <Row label="Slider">
          <Slider value={slider} onChange={setSlider} format={(v) => `${Math.round(v * 100)}%`} aria-label="Target detail" />
        </Row>
      </CollapsibleSection>

      <CollapsibleSection id="kit.nav" title="Tabs & tree">
        <Tabs
          value={tab}
          onChange={setTab}
          aria-label="Part details"
          items={[
            { value: 'general', label: 'General' },
            { value: 'generation', label: 'Generation' },
            { value: 'hinges', label: 'Hinges', disabled: true },
          ]}
        >
          <TabPanel value="general" className={styles.tabBody}>
            General tab content
          </TabPanel>
          <TabPanel value="generation" className={styles.tabBody}>
            Generation tab content
          </TabPanel>
        </Tabs>
        <div role="tree" aria-label="Example tree" className={styles.tree}>
          <TreeRow label="Body" depth={0} expanded={expanded} onToggle={() => setExpanded((v) => !v)} dotColor="var(--cat-body)" count={3} icon={Box} />
          {expanded && (
            <>
              {['door_FL', 'door_FR', 'hood'].map((id) => (
                <TreeRow
                  key={id}
                  label={id}
                  depth={1}
                  dotColor="var(--cat-panel)"
                  selected={selected === id}
                  onSelect={() => setSelected(id)}
                  onActivate={() => setSelected(id)}
                  actions={
                    <>
                      <IconButton icon={Eye} label="Toggle visibility" size="sm" />
                      <IconButton icon={Layers} label="Focus part" size="sm" />
                    </>
                  }
                />
              ))}
              <TreeRow label="engine_cover (ignored)" depth={1} muted />
            </>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection id="kit.feedback" title="Feedback">
        <Row label="Badges">
          <Badge>neutral</Badge>
          <Badge tone="accent">variant 2 of bumper_F</Badge>
          <Badge tone="success">valid</Badge>
          <Badge tone="warning">0.3 kg</Badge>
          <Badge tone="danger" mono>
            12 errors
          </Badge>
        </Row>
        <div className={styles.stack}>
          <Callout title="Sandbox is not BeamNG">In-app physics validates structure only. Verify drive feel in-game.</Callout>
          <Callout tone="warning" more="Beams stiffer than ~4M N/m on nodes under 0.5 kg exceed the 2000 Hz stability limit and will explode.">
            Node dl4r is very light for its beams.
          </Callout>
          <Callout tone="success">Export validated.</Callout>
          <Callout tone="danger" title="Export blocked">
            Part door_FL has no flexbody.
          </Callout>
        </div>
        <Row label="Status">
          <Button size="sm" onClick={() => pushStatus('Saved project', 'success')}>
            Push status
          </Button>
          <Button size="sm" onClick={() => pushStatus('Autosave failed: disk full', 'danger')}>
            Push error
          </Button>
        </Row>
      </CollapsibleSection>

      <CollapsibleSection id="kit.overlays" title="Overlays">
        <Row label="Floating">
          <Tooltip content="Tooltip with shortcut" shortcut="Ctrl+K">
            <Button size="sm">Hover me</Button>
          </Tooltip>
          <Popover trigger={<Button size="sm">Popover</Button>} title="Lights test">
            Popover content sits on a floating surface with a shadow.
          </Popover>
          <Button size="sm" onClick={() => setModal(true)}>
            Open modal
          </Button>
        </Row>
        <div className={styles.emptyBox}>
          <EmptyState icon={Inbox} message="No parts assigned yet." action={{ label: 'Auto-classify', icon: FolderTree, onClick: () => undefined }} />
        </div>
      </CollapsibleSection>

      <Modal
        open={modal}
        onOpenChange={setModal}
        title="Delete part?"
        description="This removes door_FL and its nodes. You can undo this."
        size="sm"
        footer={
          <>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setModal(false)}>
              Delete
            </Button>
          </>
        }
      />
    </ScrollArea>
  );
}
