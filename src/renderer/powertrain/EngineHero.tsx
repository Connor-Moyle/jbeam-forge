import { Eye, FileDown, Focus, Gauge, RotateCw, Wand2 } from 'lucide-react';
import { DEFAULT_SETTINGS } from '@shared/settings-schema';
import { designEngine, designName } from '@shared/powertrain/design';
import { useProjectStore } from '@renderer/app/stores/project';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { call } from '@renderer/diagnostics/ipc';
import { Button } from '@renderer/ui/components/Button';
import { Toggle } from '@renderer/ui/components/Toggle';
import { useUnits } from '@renderer/settings/useUnits';
import { importAutomationEngine, usePowertrainUi } from './commands';
import { showEngine, useEngineStage } from './engineStage';
import styles from './EngineHero.module.css';

/**
 * The top of the Engine workspace: what the engine is in one line, the way
 * in for a beginner (design one, or start from a game engine) and the view
 * options (see-through car, slow turn, look at the engine).
 */
export function EngineHero() {
  const engine = useProjectStore((s) => s.doc?.powertrain.engine ?? null);
  const settings = useSettingsStore((s) => s.settings) ?? DEFAULT_SETTINGS;
  const orbiting = useEngineStage((s) => s.orbiting);
  const active = useEngineStage((s) => s.active);
  const units = useUnits();
  const design = engine?.edits.design;
  const result = design ? designEngine(design) : null;
  const update = (patch: Partial<typeof settings>) => void call('settings:update', patch).catch(() => undefined);

  return (
    <section className={styles.hero} data-testid="engine-hero">
      <div className={styles.summary}>
        <Gauge aria-hidden className={styles.icon} />
        <div className={styles.text}>
          <strong className={styles.name}>{design ? designName(design) : engine ? `${engine.vehicle} ${engine.name}` : 'No engine yet'}</strong>
          <span className={styles.sub}>{result ? `${units.power(result.peakPower.kw)} · ${units.torque(result.peakTorque.nm)} · ${result.massKg} kg · your design on the ${engine?.vehicle} ${engine?.name}` : engine ? `${engine.type} from the game` : 'Design your own, or start from any engine in the game.'}</span>
        </div>
      </div>
      <div className={styles.actions}>
        <Button variant="primary" icon={Wand2} onClick={() => usePowertrainUi.getState().show({ kind: 'engine', page: 'design' })} data-testid="engine-design">
          {design ? 'Edit your design' : 'Design your own engine'}
        </Button>
        {!engine && (
          <Button icon={Gauge} onClick={() => usePowertrainUi.getState().show({ kind: 'engine', page: 'pick' })}>
            Start from a game engine
          </Button>
        )}
        <Button icon={FileDown} onClick={() => void importAutomationEngine()} title="An engine from a car you exported from Automation to BeamNG (the .zip in BeamNG’s mods folder)" data-testid="engine-import-automation">
          Import from Automation…
        </Button>
      </div>
      {active && (
        <div className={styles.view} data-testid="engine-view-options">
          <Toggle
            checked={settings.engineViewXray}
            onChange={(engineViewXray) => {
              update({ engineViewXray });
              showEngine(false, engineViewXray);
            }}
            label={
              <span className={styles.label}>
                <Eye aria-hidden className={styles.small} /> See-through car
              </span>
            }
          />
          <Toggle
            checked={orbiting}
            onChange={(on) => {
              useEngineStage.getState().setOrbiting(on);
              update({ engineViewOrbit: on });
            }}
            label={
              <span className={styles.label}>
                <RotateCw aria-hidden className={styles.small} /> Turn slowly
              </span>
            }
          />
          <Button size="sm" variant="ghost" icon={Focus} onClick={() => showEngine()} data-testid="engine-look">
            Look at the engine
          </Button>
        </div>
      )}
    </section>
  );
}
