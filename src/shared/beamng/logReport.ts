/**
 * What the game said about a car, from its beamng.log: the lines from the car's last load and
 * spawn, grouped by cause, in plain words, each with the parts, nodes, meshes or materials it names
 * so the app can jump to them. Later lines are often consequences of earlier ones (a car that
 * comes apart after a broken link), so the causes are ordered by how much they break.
 */

export type LogIssueKind =
  | 'unstable'
  | 'no-controller'
  | 'link'
  | 'flexbody'
  | 'mesh'
  | 'material'
  | 'texture'
  | 'variable'
  | 'zero-beam'
  | 'duplicate-beam'
  | 'jbeam'
  | 'other';

export interface LogIssue {
  kind: LogIssueKind;
  severity: 'error' | 'warning';
  /** What happened, in plain words. */
  title: string;
  /** What usually fixes it. */
  hint: string;
  count: number;
  parts: string[];
  nodes: string[];
  meshes: string[];
  materials: string[];
  /** Tuning variables named ($brakestrength). */
  variables: string[];
  /** A few of the game's own lines, as written. */
  lines: string[];
}

export interface LogReport {
  vehicle: string;
  /** Whether the log has a load of this car at all. */
  found: boolean;
  issues: LogIssue[];
}

const ORDER: LogIssueKind[] = ['no-controller', 'link', 'jbeam', 'variable', 'flexbody', 'mesh', 'material', 'texture', 'zero-beam', 'duplicate-beam', 'unstable', 'other'];

const TEXT: Record<LogIssueKind, { severity: 'error' | 'warning'; title: string; hint: string }> = {
  unstable: { severity: 'error', title: 'The car came apart in the game (instability)', hint: 'Usually a consequence of something above it. Otherwise beams too stiff for their node weights: lower the structure detail or stiffness, or raise light nodes’ weight (the Testing workspace shows which).' },
  'no-controller': { severity: 'error', title: 'No drive controller: the engine never starts', hint: 'Export again with this version: it adds the controller a car with a game engine needs.' },
  link: { severity: 'error', title: 'Parts point at nodes that aren’t there', hint: 'A borrowed part uses a node of its original car that this car doesn’t have. Export again with this version; if it stays, refit that suspension or engine.' },
  flexbody: { severity: 'error', title: 'Meshes the game couldn’t place (they stretch)', hint: 'The mesh is bound to node groups without enough nodes. Check the part’s structure, or refit the set it came with.' },
  mesh: { severity: 'warning', title: 'Moving meshes not in the model', hint: 'A borrowed part animates a mesh that wasn’t exported. Export again with this version.' },
  material: { severity: 'warning', title: 'Materials the game couldn’t find', hint: 'Those meshes show untextured. Export again with this version: it brings other cars’ material definitions along.' },
  texture: { severity: 'warning', title: 'Textures that didn’t load', hint: 'Check the file exists (another mod may define a material of the same name).' },
  variable: { severity: 'error', title: 'Tuning variables with no value', hint: 'A borrowed part’s formula uses a variable nothing defines. Export again with this version: it adds them.' },
  'zero-beam': { severity: 'warning', title: 'Beams with no length', hint: 'Two of a beam’s nodes are in the same place. Export again with this version, or move one of them.' },
  'duplicate-beam': { severity: 'warning', title: 'The same beam twice', hint: 'Harmless but wasteful. Export again with this version.' },
  jbeam: { severity: 'error', title: 'The game couldn’t read part of the jbeam', hint: 'Check the part named in the lines below.' },
  other: { severity: 'warning', title: 'Other errors while the car loaded', hint: 'See the lines below.' },
};

function issue(kind: LogIssueKind): LogIssue {
  return { kind, ...TEXT[kind], count: 0, parts: [], nodes: [], meshes: [], materials: [], variables: [], lines: [] };
}

const add = (list: string[], v: string | undefined) => {
  if (v && !list.includes(v) && list.length < 40) list.push(v);
};

export function vehicleLogReport(log: string, vehicle: string): LogReport {
  const lines = log.split(/\r?\n/);
  const spawnRe = /spawning vehicle \/vehicles\/([^/\s]+)\//;
  let spawn = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (spawnRe.exec(lines[i]!)?.[1] === vehicle) {
    spawn = i;
    break;
  }
  if (spawn < 0) return { vehicle, found: false, issues: [] };
  // The car's load starts after the previous vehicle's spawn (the game loads, then spawns).
  let start = 0;
  for (let i = spawn - 1; i >= 0; i--) if (spawnRe.test(lines[i]!)) {
    start = i + 1;
    break;
  }
  let end = lines.length;
  for (let i = spawn + 1; i < lines.length; i++) if (spawnRe.test(lines[i]!)) {
    end = i;
    break;
  }
  const byKind = new Map<LogIssueKind, LogIssue>();
  const get = (k: LogIssueKind) => byKind.get(k) ?? byKind.set(k, issue(k)).get(k)!;
  const partOfPath = (p: string | undefined) => p?.split('/').filter(Boolean).at(-1);
  for (const raw of lines.slice(start, end)) {
    const l = raw.trim();
    let m: RegExpExecArray | null;
    let it: LogIssue | null = null;
    if ((m = /Instability detected for vehicle ID: \d+, jbeamFilename: "([^"]+)"/.exec(l)) && m[1] === vehicle) it = get('unstable');
    else if (/No main controller found/.test(l)) it = get('no-controller');
    else if ((m = /link target not found: \w+\/\d+ > nodes\/(\S+).*partPath: (\S+)/.exec(l))) {
      it = get('link');
      add(it.nodes, m[1]);
      add(it.parts, partOfPath(m[2]));
    } else if ((m = /FLEXBODY ERROR on mesh (\S+?):/.exec(l))) {
      it = get('flexbody');
      add(it.meshes, m[1]);
    } else if ((m = /Mesh '([^']+)' not found/.exec(l)) || (m = /unable to find rigid mesh: (\S+)/.exec(l))) {
      it = get('mesh');
      add(it.meshes, m[1]);
    } else if ((m = /NO-MATERIAL\] Unable to find material mapping to: (\S+)/.exec(l))) {
      it = get('material');
      add(it.materials, m[1]);
    } else if ((m = /Failed to load '\w+' map '([^']+)' for stage \d+ of material '([^']+)'/.exec(l))) {
      it = get('texture');
      add(it.materials, m[2]);
    } else if ((m = /arithmetic on global 'var_(\w+)'/.exec(l))) {
      it = get('variable');
      add(it.variables, `$${m[1]}`);
    } else if ((m = /zero size beam between nodes (\S+) and ([^\s,]+)/.exec(l))) {
      it = get('zero-beam');
      add(it.nodes, m[1]);
      add(it.nodes, m[2]);
    } else if ((m = /duplicated beam between nodes: (\S+) and (\S+)/.exec(l))) {
      it = get('duplicate-beam');
      add(it.nodes, m[1]);
      add(it.nodes, m[2]);
    } else if (/\|E\|.*jbeam/i.test(l) && l.includes(vehicle)) it = get('jbeam');
    else if (/\|E\|/.test(l) && l.includes(vehicle)) it = get('other');
    if (!it) continue;
    it.count++;
    if (it.lines.length < 6) it.lines.push(l.length > 400 ? `${l.slice(0, 400)}…` : l);
    // Part names on the line (vehicle_…): jump-to targets.
    for (const p of l.match(new RegExp(`\\b${vehicle}_[A-Za-z0-9_.]+`, 'g')) ?? []) add(it.parts, p);
  }
  const issues = [...byKind.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return { vehicle, found: true, issues };
}
