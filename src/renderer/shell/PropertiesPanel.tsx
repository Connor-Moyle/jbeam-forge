import { Fragment } from 'react';
import { useUiStore } from '@renderer/app/stores/ui';
import { cx } from '@renderer/ui/cx';
import { iconSize } from '@renderer/ui/tokens';
import { Tooltip } from '@renderer/ui/components/Tooltip';
import { useOptionalShell } from './ShellContext';
import { PanelFrame } from './PanelFrame';
import { PANELS } from './panelRegistry';
import { PROPERTY_TABS, PROPERTY_TAB_BREAKS, type PropertyTab } from './propertyTabs';
import styles from './PropertiesPanel.module.css';

/** What each tab is for, shown when the pointer rests on it. */
const TAB_HINTS: Record<PropertyTab, string> = {
  inspector: 'Inspector: the picked part, mesh, node or beam',
  materials: 'Materials: every material on the car',
  paints: 'Paints: factory paints, paint slots, and painting on the car',
  skins: 'Skin studio: liveries players can pick in game',
  suspension: "Suspension: axles, and suspensions from the game's cars",
  powertrain: 'Engine and gearbox',
  configs: 'Configurations: versions of the car and their parts (.pc)',
  features: 'Extras: licence plates, tow hitch, nitrous, paint designs',
  objects: 'Objects library: calipers, discs, gauges…',
  reference: 'Reference car: specs and data files of a car brought over from another game',
};

/**
 * The Properties column, laid out like Blender's: a strip of tabs down the side
 * and the picked tab's tool beside it. Every tool that works on the car or the
 * picked part lives here, so opening one never squeezes another off the screen.
 */
export function PropertiesPanel() {
  const tab = useUiStore((s) => s.propsTab);
  const setTab = useUiStore((s) => s.setPropsTab);
  const shell = useOptionalShell();
  const pick = (id: PropertyTab) => (shell ? shell.togglePanel(id) : setTab(id));
  const Icon = PANELS[tab].icon;

  return (
    <div className={styles.properties} data-testid="properties" data-tab={tab}>
      <div className={styles.rail} role="tablist" aria-orientation="vertical" aria-label="Properties">
        {PROPERTY_TABS.map((id) => {
          const TabIcon = PANELS[id].icon;
          return (
            <Fragment key={id}>
              {PROPERTY_TAB_BREAKS.includes(id) && <span className={styles.break} aria-hidden />}
              <Tooltip content={TAB_HINTS[id]} side="left">
                <button type="button" role="tab" aria-selected={tab === id} aria-label={PANELS[id].title} className={cx(styles.tab, tab === id && styles.tabOn)} onClick={() => pick(id)} data-testid={`toggle-${id}`}>
                  <TabIcon size={iconSize('size-icon')} aria-hidden />
                </button>
              </Tooltip>
            </Fragment>
          );
        })}
      </div>
      <div className={styles.body} role="tabpanel" aria-label={PANELS[tab].title}>
        <div className={styles.heading}>
          <Icon size={iconSize('size-icon-sm')} aria-hidden />
          {PANELS[tab].title}
        </div>
        <div className={styles.content}>
          <PanelFrame key={tab} id={tab} />
        </div>
      </div>
    </div>
  );
}
