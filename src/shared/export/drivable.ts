import { isJbeamObject, parseJbeam, type JbeamObject, type JbeamValue } from '../jbeam/parse';
import GAME_VARIABLES from './gameVariables.json';

/**
 * What a car's own main part must provide for the game's parts it borrows. A game car declares its
 * drive controller, fuel tanks and some tuning variables in its body and main parts, which a mod
 * never brings: without them a borrowed engine has no controller ("No main controller found") and
 * no fuel, and formulas using $brakestrength and the like fail. This looks at every part written
 * and adds to the main part only what nothing else defines.
 */

export interface MainAdditions {
  controller: JbeamValue[][] | null;
  energyStorage: JbeamValue[][] | null;
  /** Storage name → its settings section. */
  storages: Record<string, JbeamObject>;
  /** Variables table rows to add. */
  variables: JbeamValue[][];
  /** Variables used but defined nowhere, not even in the game's own parts (given a neutral default). */
  unknownVariables: string[];
}

const TABLE = GAME_VARIABLES as unknown as Record<string, JbeamValue[]>;

function walk(v: JbeamValue | undefined, visit: (key: string, value: JbeamValue) => void): void {
  if (Array.isArray(v)) for (const x of v) walk(x, visit);
  else if (isJbeamObject(v))
    for (const [k, x] of Object.entries(v)) {
      visit(k, x);
      walk(x, visit);
    }
}

export function mainAdditions(texts: readonly string[], hasEngine: boolean): MainAdditions {
  const parts: JbeamObject[] = [];
  for (const t of texts) {
    try {
      const v = parseJbeam(t).value;
      if (isJbeamObject(v)) for (const p of Object.values(v)) if (isJbeamObject(p)) parts.push(p);
    } catch {
      /* our own writer's output: a parse failure shows in the game's log */
    }
  }

  // The drive controller: one vehicleController for the whole car.
  let hasController = false;
  for (const p of parts) if (Array.isArray(p.controller) && p.controller.some((r) => Array.isArray(r) && r[0] === 'vehicleController')) hasController = true;

  // Fuel and batteries: what the engines and motors ask for, less what some part already holds.
  const wanted = new Map<string, string>(); // storage name → energy type
  const defined = new Set<string>();
  for (const p of parts) {
    if (Array.isArray(p.energyStorage)) for (const r of p.energyStorage.slice(1)) if (Array.isArray(r) && typeof r[1] === 'string') defined.add(r[1]);
    for (const section of Object.values(p)) {
      if (!isJbeamObject(section) || typeof section.requiredEnergyType !== 'string') continue;
      const names = typeof section.energyStorage === 'string' ? [section.energyStorage] : Array.isArray(section.energyStorage) ? section.energyStorage.filter((n): n is string => typeof n === 'string') : ['mainTank'];
      for (const n of names) if (!wanted.has(n)) wanted.set(n, section.requiredEnergyType);
    }
  }
  const missing = [...wanted].filter(([n]) => !defined.has(n));
  const storages: Record<string, JbeamObject> = {};
  const storageRows: JbeamValue[][] = [];
  const electricCount = missing.filter(([, t]) => t === 'electricEnergy').length;
  const fuelCount = missing.length - electricCount;
  for (const [name, type] of missing) {
    if (type === 'electricEnergy') {
      storageRows.push(['electricBattery', name]);
      storages[name] = { energyType: type, batteryCapacity: Math.round(60 / electricCount), startingCapacity: '$fuel' };
    } else {
      storageRows.push(['fuelTank', name]);
      // Fuel catches fire with the engine's fuel group, as the game's tanks do.
      storages[name] = { energyType: type, fuelCapacity: Math.round(60 / fuelCount), startingFuelCapacity: '$fuel', fuel: { '[engineGroup]:': ['fuel'] } };
    }
  }

  // Variables: every $name used, less those some part defines.
  const definedVars = new Set<string>();
  const used = new Set<string>();
  for (const p of parts) {
    if (Array.isArray(p.variables)) for (const r of p.variables.slice(1)) if (Array.isArray(r) && typeof r[0] === 'string') definedVars.add(r[0]);
    walk(p, (key, value) => {
      // Slot-level variables ({"variables": {"$posX": …}}) are defined where they're used.
      if (key === 'variables' && isJbeamObject(value)) for (const k of Object.keys(value)) definedVars.add(k);
      if (typeof value === 'string') for (const m of value.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(`$${m[1]}`);
    });
  }
  if (missing.length) used.add('$fuel');
  const variables: JbeamValue[][] = [];
  const unknownVariables: string[] = [];
  for (const name of [...used].sort()) {
    if (definedVars.has(name)) continue;
    const known = name === '$fuel' && electricCount && !fuelCount ? ['range', 'kWh', 'Chassis', 60, 0, 60, 'Battery Level', 'Initial battery charge'] : name === '$fuel' ? ['range', 'L', 'Chassis', Math.round(60 / Math.max(1, fuelCount)), 0, Math.round(60 / Math.max(1, fuelCount)), 'Fuel Volume', 'Initial fuel volume'] : TABLE[name];
    if (known) variables.push([name, ...known]);
    else {
      unknownVariables.push(name);
      variables.push([name, 'range', '', 'Other', 1, 0, 2, name.slice(1), 'Used by a part from the game; set here so it has a value']);
    }
  }

  return {
    controller: hasEngine && !hasController ? [['fileName'], ['vehicleController', {}]] : null,
    energyStorage: storageRows.length ? [['type', 'name'], ...storageRows] : null,
    storages,
    variables,
    unknownVariables,
  };
}
