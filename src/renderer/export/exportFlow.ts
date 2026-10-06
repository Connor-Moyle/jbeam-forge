import { creditsForSources, creditsText } from '@shared/credits';
import { create } from 'zustand';
import { withMeshNames } from '@shared/parts/meshNames';
import { slotsOf } from '@renderer/materials/seed';
import { call, IpcCallError } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { errorReport } from '@renderer/diagnostics/errorReport';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { useSettingsStore } from '@renderer/app/stores/settings';
import { capturePreview, captureStudio } from '@renderer/panels/viewport/registry';
import { syncPreviewPaints } from '@renderer/paint/preview';
import { useConfigUi } from '@renderer/configs/commands';
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings-schema';
import { currentTaxonomy } from '@renderer/parts/taxonomy';
import type { ExportBundle, PublishListing } from '@shared/ipc-contract';
import { bodyPart, buildJbeamFiles, damagedMaterialName, nodesExported, SET_KINDS } from '@shared/export/jbeam';
import type { Project } from '@shared/project/schema';
import { buildGlowMap, lightFunction, onMaterialName } from '@shared/export/lights';
import { loadFittedSets, useSetData } from '@renderer/suspension/commands';
import { exportMeshNames, infoJson, materialsJson } from '@shared/export/files';
import { configFileName, configInfoJson, includedParts, resolveConfig } from '@shared/export/configs';
import { configLabels, configStats } from '@shared/export/configStats';
import { exportScripts } from '@shared/lua/export';
import { checkLua } from '@shared/lua/check';
import { templateById } from '@renderer/scripts/registry';
import { validateExport, type ValidationReport } from '@shared/export/validate';
import { writeDae, type DaeMesh } from './dae';
import { exportableProps } from '@shared/props/props';
import { withPaintedFaces } from '@renderer/paint/facePaint';
import { collectMaterials, createTextureNamer, projectMaterialExport, skinMaterialsJson, type TextureCopy } from './materials';
import { textureToDds, toBase64 } from './textureConvert';
import { portedIssues, portedText } from '@shared/export/ported';
import { installProblems } from '@shared/export/installCheck';
import { stampGameVersion } from './gameVersion';
import { wheelNames } from '@shared/suspension/wheels';
import { powertrainDevices } from '@shared/powertrain/specs';
import { commonRoot, engineModFiles, panelModFiles, rimModFiles, toCommon, tyreModFiles, type ModKind } from '@shared/export/modKinds';

const logger = rlog('export');

/**
 * Export Mod (SPEC §4.15): builds the complete `vehicles/<slug>/` folder in
 * the renderer (DAE, jbeam per part, materials, info, default config, preview)
 * and hands it to main, which installs it unpacked into BeamNG's mods folder
 * or writes a zip.
 */

export interface PreparedExport {
  /** Copies may still be marked for DDS conversion (finalBundle does it). */
  bundle: Omit<ExportBundle, 'copies'> & {
    copies: TextureCopy[];
    /** Material names the meshes use that the mod doesn't define: the game's (finalBundle brings other cars' along). */
    gameMaterials?: string[];
  };
  report: ValidationReport;
  summary: { parts: number; meshes: number; nodes: number; beams: number; textures: number; daeBytes: number };
}

interface ExportUiState {
  open: boolean;
  prepared: PreparedExport | null;
  busy: string | null;
  result: { path: string; bytes: number; mode: 'install' | 'zip' | 'publish'; clashes?: string[] } | null;
  error: string | null;
  /** The short, copyable report for `error` (where it happened). */
  errorDetail: string | null;
  setOpen: (open: boolean) => void;
  set: (patch: Partial<Omit<ExportUiState, 'setOpen' | 'set'>>) => void;
}

export const useExportUi = create<ExportUiState>()((set) => ({
  open: false,
  prepared: null,
  busy: null,
  result: null,
  error: null,
  errorDetail: null,
  setOpen: (open) => set({ open, ...(open ? {} : { prepared: null, result: null, error: null, errorDetail: null, busy: null }) }),
  set: (patch) => set(patch),
}));

/** Show a failure in the dialog, log it with its stack, and keep a short report to copy. */
function fail(where: string, err: unknown, prefix = ''): void {
  logger.error(`${where} failed:`, err instanceof Error ? (err.stack ?? err.message) : String(err));
  useExportUi.getState().set({ error: `${prefix}${errorText(err)}`, errorDetail: errorReport({ where, error: err }) });
}

function errorText(err: unknown): string {
  if (err instanceof IpcCallError) return err.ipcError.message;
  return err instanceof Error ? err.message : String(err);
}

function base64FromDataUrl(url: string): string {
  return url.slice(url.indexOf(',') + 1);
}

/** Build everything (no side effects) and validate it. */
export function prepareExport(): PreparedExport | null {
  const doc = projectStore.getState().doc;
  if (!doc) return null;
  const slug = doc.meta.slug;
  const tax = currentTaxonomy();
  const author = useSettingsStore.getState().settings?.author || doc.meta.author;
  const sources = Object.values(useSceneStore.getState().sources);
  const formatOf = new Map(doc.sources.map((s) => [s.id, s.format]));
  const kind = doc.meta.modKind ?? 'vehicle';
  // A panel mod's guide (the stock panel, to line up against) is never exported.
  const guide = kind === 'panel' ? doc.panel?.guideSourceId : null;
  const allMeshes = withMeshNames(doc, sources.filter((s) => s.sourceId !== guide).flatMap((s) => s.meshes));
  // A tyre, wheel or panel mod's meshes are its flexbodies: every mesh goes, parts or not.
  const wheelish = kind === 'tyres' || kind === 'wheels' || kind === 'panel';
  const meshNames = exportMeshNames(wheelish ? { ...doc, assignments: { ...Object.fromEntries(allMeshes.map((m) => [m.key, 'mesh'])), ...doc.assignments } } : doc, allMeshes);
  const exported = allMeshes.filter((m) => meshNames.has(m.key));

  // Project materials first; a mesh without any (shouldn't happen after import) keeps its imported one.
  const namer = createTextureNamer(slug, { dds: ddsWanted(doc) });
  const takenNames = new Set<string>();
  const usedIds = new Set(exported.flatMap((m) => slotsOf(doc, m.key) ?? []));
  // Materials painted onto meshes' triangles go too.
  for (const m of exported) for (const e of doc.faceMaterials[m.key] ?? []) if (doc.materials.some((d) => d.id === e.materialId)) usedIds.add(e.materialId);
  // Two-sided materials bring their back material along.
  const backOf = (id: string) => {
    const back = doc.materials.find((d) => d.id === id)?.backMaterialId;
    return back && back !== id && doc.materials.some((d) => d.id === back) ? back : null;
  };
  for (const id of [...usedIds]) {
    const back = backOf(id);
    if (back) usedIds.add(back);
  }
  const project = projectMaterialExport(slug, doc.materials.filter((d) => usedIds.has(d.id)), namer, takenNames);
  const unslotted = exported.filter((m) => !slotsOf(doc, m.key)?.length);
  const mats = collectMaterials(
    slug,
    unslotted.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])),
    namer,
    takenNames,
  );
  // Only props the jbeam can hang get their origin at the pivot; the rest stay plain flexbodies.
  const propPivot = new Map([...exportableProps(doc, bodyPart(doc, tax)?.id, nodesExported(doc, tax))].map(([k, x]) => [k, x.prop.pivot] as const));
  // Vehicle scripts: controllers, keys, their files, and meshes that become live screens.
  const body = bodyPart(doc, tax);
  const scripts = exportScripts(doc.scripts ?? [], { slug, bodyPartId: body?.id ?? null, partIds: new Set(doc.parts.filter((p) => !SET_KINDS.has(p.taxonomyId)).map((p) => p.id)), template: templateById });
  const screens = new Map(scripts.screens.map((sc) => [sc.meshKey, sc]));
  const daeMeshes: DaeMesh[] = exported.map((m) => {
    const imported = Array.isArray(m.material) ? m.material : [m.material];
    const screen = screens.get(m.key);
    if (screen) {
      // The whole mesh shows the screen's page (one material for every group).
      const groups = Math.max(1, m.geometry.groups.length);
      return { name: meshNames.get(m.key)!, geometry: m.geometry, materials: Array.from({ length: groups }, () => screen.name), flipV: formatOf.get(m.sourceId) === 'gltf' || formatOf.get(m.sourceId) === 'glb' };
    }
    const ids = slotsOf(doc, m.key);
    const materials = ids?.length ? ids.map((id) => project.names.get(id) ?? `${slug}_missing`) : imported.map((mat) => mats.names.get(mat)!);
    const back = ids?.some((id) => backOf(id)) ? ids.map((id) => (backOf(id) ? (project.names.get(backOf(id)!) ?? null) : null)) : undefined;
    // Painted materials: their triangles become material groups of their own.
    const painted = withPaintedFaces(m.geometry, doc.faceMaterials[m.key], { materials, ...(back ? { back } : {}) }, (id) => {
      const name = project.names.get(id);
      const b = backOf(id);
      return name ? { name, back: b ? (project.names.get(b) ?? null) : null } : null;
    });
    return {
      name: meshNames.get(m.key)!,
      geometry: painted.geometry,
      materials: painted.materials,
      ...(painted.backMaterials ? { backMaterials: painted.backMaterials } : {}),
      flipV: formatOf.get(m.sourceId) === 'gltf' || formatOf.get(m.sourceId) === 'glb',
      // Animated parts turn about their pivot, which the game takes from the mesh's origin.
      ...(propPivot.has(m.key) ? { origin: propPivot.get(m.key)! } : {}),
    };
  });
  const dae = writeDae(daeMeshes, [...project.colors, ...mats.materials.map((m) => ({ name: m.name, color: m.baseColor })), ...scripts.screens.map((sc) => ({ name: sc.name, color: [0.02, 0.02, 0.02, 1] as [number, number, number, number] }))]);
  // Lights: materials used only by light parts glow with their signal (an "on" twin of each).
  const partOf = (key: string) => doc.parts.find((p) => p.id === doc.assignments[key]);
  const { glowMap, shared: sharedLights } = buildGlowMap(
    daeMeshes.flatMap((dm, i) => {
      const part = partOf(exported[i]!.key);
      const light = part ? lightFunction(part.taxonomyId, part.position) : null;
      return dm.materials.map((material) => ({ material, light }));
    }),
  );
  const materialJsonAll: Record<string, unknown> = { ...project.json, ...materialsJson(slug, mats.materials), ...skinMaterialsJson(slug, doc.materials, doc.features.skins, project.names, namer) };
  // Live screens: the page the game draws (a dynamic texture), lit.
  for (const sc of scripts.screens) {
    materialJsonAll[sc.name] = { name: sc.name, mapTo: sc.name, class: 'Material', version: 1.5, Stages: [{ baseColorMap: sc.texture, emissiveMap: sc.texture, emissiveFactor: [1, 1, 1], roughnessFactor: 0.2, metallicFactor: 0 }, {}, {}, {}], translucent: false };
  }
  for (const name of Object.keys(glowMap)) {
    const off = materialJsonAll[name] as { Stages?: Record<string, unknown>[] } | undefined;
    if (!off) {
      delete glowMap[name]; // a game material: its own glow is the game's business
      continue;
    }
    const on = structuredClone(off) as { name?: string; mapTo?: string; Stages?: Record<string, unknown>[] };
    on.name = onMaterialName(name);
    on.mapTo = onMaterialName(name);
    const stage = on.Stages?.[0];
    if (stage) {
      const color = Array.isArray(stage.baseColorFactor) ? (stage.baseColorFactor as number[]).slice(0, 3) : [1, 1, 1];
      stage.emissiveFactor = color;
      stage.glow = true;
      if (typeof stage.baseColorMap === 'string') stage.emissiveMap = stage.baseColorMap;
    }
    materialJsonAll[onMaterialName(name)] = on;
  }
  // Glass: a frosted, cracked-looking twin of each glass material for when it shatters.
  for (const [i, dm] of daeMeshes.entries()) {
    const part = partOf(exported[i]!.key);
    if (!part || tax.entry(part.taxonomyId)?.beamPreset !== 'glass_brittle') continue;
    const name = dm.materials[0];
    const base = name ? (materialJsonAll[name] as { Stages?: Record<string, unknown>[] } | undefined) : undefined;
    if (!name || !base || materialJsonAll[damagedMaterialName(name)]) continue;
    const dmg = structuredClone(base) as { name?: string; mapTo?: string; Stages?: Record<string, unknown>[] };
    dmg.name = damagedMaterialName(name);
    dmg.mapTo = damagedMaterialName(name);
    const stage = dmg.Stages?.[0];
    if (stage) {
      stage.roughnessFactor = 0.85;
      stage.opacityFactor = Math.max(0.75, typeof stage.opacityFactor === 'number' ? stage.opacityFactor : 0);
    }
    materialJsonAll[damagedMaterialName(name)] = dmg;
  }
  const meshMaterials = new Map(daeMeshes.map((dm) => [dm.name, dm.materials]));
  const jbeams = buildJbeamFiles(doc, tax, { meshNames, author, suspensions: useSetData.getState().data, glowMap, meshMaterials, scripts: scripts.parts });
  const root = `vehicles/${slug}`;
  // The default configuration, then every one made in the Configurations panel: a .pc, its info and a preview each.
  const configs = [null, ...doc.configs];
  const taken = new Set<string>();
  const configFiles: ExportBundle['files'] = [];
  const configChoices: { name: string; parts: Record<string, string> }[] = [];
  let defaultPc = 'default';
  for (const config of configs) {
    let file = configFileName(config);
    for (let i = 2; taken.has(file); i++) file = `${configFileName(config)}_${i}`;
    taken.add(file);
    const pc = resolveConfig(doc, tax, config, useSetData.getState().data);
    configChoices.push({ name: config?.name ?? 'the default configuration', parts: pc.parts });
    if (config && config.id === doc.defaultConfigId) defaultPc = file;
    const labels = configLabels(configStats(doc, tax, pc, useSetData.getState().data), config?.info);
    configFiles.push({ path: `${root}/${file}.pc`, text: `${JSON.stringify(pc, null, 2)}\n` }, { path: `${root}/info_${file}.json`, text: `${JSON.stringify(configInfoJson(doc, tax, pc, config, labels), null, 2)}\n` });
    const everyConfig = useSettingsStore.getState().settings?.previewEveryConfig ?? true;
    const preview = config && !everyConfig ? null : capturePreviewOf(doc, includedParts(doc, tax, pc, useSetData.getState().data), config?.id ?? null);
    if (preview) configFiles.push({ path: `${root}/${file}.jpg`, base64: base64FromDataUrl(preview) });
  }
  const files: ExportBundle['files'] = [
    { path: `${root}/${slug}.dae`, text: dae },
    ...jbeams.map((j) => ({ path: `${root}/${j.file}`, text: j.text })),
    { path: `${root}/main.materials.json`, text: `${JSON.stringify(materialJsonAll, null, 2)}\n` },
    { path: `${root}/info.json`, text: `${JSON.stringify(infoJson(doc, author, defaultPc), null, 2)}\n` },
    ...configFiles,
    ...scripts.files.map((f) => (f.base64 !== undefined ? { path: f.path, base64: f.base64 } : { path: f.path, text: f.text ?? '' })),
  ];

  const exportedSources = new Set(exported.map((m) => m.sourceId));
  const missingTextures = sources.filter((s) => exportedSources.has(s.sourceId)).flatMap((s) => (s.textures?.missing ?? []).map((ref) => ({ material: s.fileName, ref })));
  const report = validateExport(doc, tax, {
    meshNames,
    daeNodes: new Set(daeMeshes.map((m) => m.name)),
    missingTextures,
    loadedMeshKeys: allMeshes.map((m) => m.key),
  });
  for (const e of scripts.errors) report.errors.push({ code: 'SCRIPT', message: e });
  // A suspension that is the whole running gear (four wheels: a box trailer's) on one axle, and
  // another on the other: two sets of wheels in the same place.
  const fittedAxles = (doc.axles ?? []).filter((a) => a.fitted);
  for (const a of fittedAxles) {
    const wheels = wheelNames(useSetData.getState().data[a.fitted!.setId]?.parts ?? {});
    if (wheels.length > 2 && fittedAxles.length > 1) report.errors.push({ code: 'SUSPENSION_BOTH_AXLES', message: `${a.fitted!.name} on the ${a.name.replace(/ axle$/i, '')} axle is the whole running gear (wheels ${wheels.join(', ')}): it covers both axles. Remove the other axle's suspension, or choose a suspension for one axle.` });
  }
  // An electric motor through a gearbox with a clutch: the game's clutch needs a combustion engine's
  // inertia, and the car can't start (it came apart in testing).
  const pt = doc.powertrain;
  const setData = useSetData.getState().data;
  const devices = (setId: string | undefined) => (setId ? Object.values(setData[setId]?.parts ?? {}).flatMap(powertrainDevices) : []);
  if (pt?.engine && pt.gearbox) {
    const engine = devices(pt.engine.setId);
    if (engine.includes('electricMotor') && !engine.includes('combustionEngine') && devices(pt.gearbox.setId).includes('frictionClutch'))
      report.errors.push({ code: 'ELECTRIC_WITH_CLUTCH', message: `${pt.engine.name} is electric, and ${pt.gearbox.name} has a clutch made for a combustion engine: the game can't run the two together. Choose an electric car's gearbox (a single reduction), or no gearbox.` });
  }
  // The jbeam as the game will assemble it, configuration by configuration.
  if (kind === 'vehicle') {
    const seen = new Set<string>();
    for (const c of configChoices)
      for (const message of installProblems(jbeams, slug, c.parts, `${slug}_`)) {
        if (seen.has(message)) continue;
        seen.add(message);
        report.errors.push({ code: 'ASSEMBLY', message: configChoices.length > 1 ? `${c.name}: ${message}` : message });
      }
  }
  for (const w of scripts.warnings) report.warnings.push({ code: 'SCRIPT', message: w });
  // Settings → Scripts: warnings in a script's code stop the export too.
  if (useSettingsStore.getState().settings?.scriptStrictExport) {
    for (const sc of doc.scripts ?? []) {
      if (!sc.enabled) continue;
      const code = sc.code ?? (sc.templateId ? templateById(sc.templateId)?.lua : '') ?? '';
      const first = checkLua(code, { controller: true }).diagnostics.find((d) => d.severity === 'warning');
      if (first) report.errors.push({ code: 'SCRIPT', message: `${sc.label} (${sc.name}.lua) line ${first.line}: ${first.message} (Settings → Scripts: warnings stop the export)` });
    }
  }
  // Ported from another game: the declaration must be complete, and the credit ships with the mod.
  for (const message of portedIssues(doc.meta.portedFrom)) report.errors.push({ code: 'PORTED', message });
  if (doc.meta.portedFrom && kind === 'vehicle') files.push({ path: `${root}/ported_from.txt`, text: portedText(doc.meta.portedFrom, doc.meta.name, author) });
  // Models made by others (the practice car): their credit ships with the mod.
  const credits = creditsForSources(doc.sources.map((src) => src.absolutePath));
  if (credits.length && kind === 'vehicle') files.push({ path: `${root}/credits.txt`, text: creditsText(credits, doc.meta.name) });
  if (kind !== 'vehicle') return partModExport(doc, kind, { author, files, copies: mats.copies, dae, meshCount: exported.length, meshNames: daeMeshes.map((m) => m.name) });
  for (const m of sharedLights) report.warnings.push({ code: 'LIGHT_SHARED_MATERIAL', message: `Material ${m} is on a light and on other parts too, so it won't glow (or the other parts would). Give the light its own material.` });
  return {
    bundle: { slug, projectName: doc.meta.name, files, copies: mats.copies, gameMaterials: [...new Set(daeMeshes.flatMap((m) => m.materials))].filter((n) => !(n in materialJsonAll)) },
    report,
    summary: { parts: doc.parts.length, meshes: exported.length, nodes: doc.nodes.length, beams: doc.beams.length, textures: mats.copies.length, daeBytes: dae.length },
  };
}

/**
 * A studio picture of one configuration for the vehicle selector: only its
 * parts showing and its paints on (both put back afterwards).
 */
export function capturePreviewOf(doc: Pick<Project, 'assignments' | 'paints' | 'configs'>, parts: ReadonlySet<string>, configId: string | null, over?: Partial<Pick<Settings, 'previewSize' | 'previewAngle' | 'previewBackdrop'>>): string | null {
  const scene = useSceneStore.getState();
  const before = scene.hidden;
  const hide = Object.keys(doc.assignments).filter((k) => !parts.has(doc.assignments[k]!) && !before[k]);
  const s = { ...DEFAULT_SETTINGS, ...useSettingsStore.getState().settings, ...over };
  const [width, height] = s.previewSize.split('x').map(Number) as [number, number];
  if (hide.length) scene.setHidden(hide, true);
  syncPreviewPaints(doc, configId);
  try {
    return captureStudio({ width, height, angle: s.previewAngle, backdrop: s.previewBackdrop }) ?? capturePreview();
  } finally {
    if (hide.length) scene.setHidden(hide, false);
    const ui = useConfigUi.getState();
    syncPreviewPaints(projectStore.getState().doc, ui.preview ? ui.selected : null);
  }
}

export async function openExport(): Promise<void> {
  const ui = useExportUi.getState();
  ui.setOpen(true);
  await loadFittedSets().catch((err: unknown) => logger.warn('suspension jbeam not loaded:', errorText(err)));
  try {
    ui.set({ prepared: prepareExport(), error: null, errorDetail: null, result: null });
  } catch (err) {
    fail('Export: checking the mod', err, 'Could not prepare the export: ');
  }
}

/** Refresh after fixing problems (e.g. generating missing structure). */
export function refreshExport(): void {
  const ui = useExportUi.getState();
  try {
    ui.set({ prepared: prepareExport(), error: null, errorDetail: null });
  } catch (err) {
    fail('Export: re-check', err);
  }
}

/**
 * An engine, tyre or wheel mod: its own files instead of a vehicle's. Tyres
 * and wheels keep their mesh and materials under vehicles/common/<slug>/;
 * an engine is only jbeam, beside each car it fits.
 */
function partModExport(doc: Project, kind: Exclude<ModKind, 'vehicle'>, v: { author: string; files: ExportBundle['files']; copies: TextureCopy[]; dae: string; meshCount: number; meshNames: string[] }): PreparedExport {
  const slug = doc.meta.slug;
  const errors: { code: string; message: string }[] = [];
  const warnings: { code: string; message: string }[] = [];
  let files: ExportBundle['files'] = [];
  let copies: TextureCopy[] = [];
  if (kind === 'engine') {
    const r = engineModFiles(doc, v.author, useSetData.getState().data);
    files = r.files;
    for (const message of r.errors) errors.push({ code: 'ENGINE', message });
  } else if (kind === 'panel') {
    if (!doc.panel) errors.push({ code: 'PANEL', message: 'Pick the car and the panel this mod replaces in the Panel builder.' });
    const r = doc.panel ? panelModFiles(slug, v.author, doc.meta.name, doc.panel, useSetData.getState().data[doc.panel.setId], v.meshNames) : { files: [], errors: [] };
    for (const message of r.errors) errors.push({ code: 'PANEL', message });
    // The mesh and its materials go where every car finds them; the part goes beside the car it fits.
    const mine = new RegExp(`/vehicles/${slug}/`, 'g');
    files = [
      ...(v.meshCount ? [{ path: `${commonRoot(slug)}/${slug}.dae`, text: v.dae }] : []),
      ...r.files,
      ...v.files.filter((f) => f.path.endsWith('main.materials.json') && v.meshCount).map((f) => ({ path: toCommon(f.path, slug), text: (f.text ?? '').replace(mine, `/${commonRoot(slug)}/`) })),
    ];
    copies = v.meshCount ? v.copies.map((c) => ({ ...c, to: toCommon(c.to, slug) })) : [];
  } else {
    const spec = kind === 'tyres' ? doc.tyre : doc.rim;
    if (!spec) errors.push({ code: 'SPEC', message: kind === 'tyres' ? 'Set up the tyre in the Tyre builder first.' : 'Set up the wheel in the Wheel builder first.' });
    if (!v.meshCount) warnings.push({ code: 'NO_MESH', message: `No mesh: the ${kind === 'tyres' ? 'tyre' : 'wheel'} works but is invisible. Import its model (centred on the origin, turning about X).` });
    const jbeam = !spec ? [] : kind === 'tyres' ? tyreModFiles(slug, v.author, doc.tyre!, v.meshNames) : rimModFiles(slug, v.author, doc.rim!, v.meshNames);
    const mine = new RegExp(`/vehicles/${slug}/`, 'g');
    files = [
      ...(v.meshCount ? [{ path: `${commonRoot(slug)}/${slug}.dae`, text: v.dae }] : []),
      ...jbeam,
      ...v.files.filter((f) => f.path.endsWith('main.materials.json') && v.meshCount).map((f) => ({ path: toCommon(f.path, slug), text: (f.text ?? '').replace(mine, `/${commonRoot(slug)}/`) })),
    ];
    copies = v.meshCount ? v.copies.map((c) => ({ ...c, to: toCommon(c.to, slug) })) : [];
  }
  for (const message of portedIssues(doc.meta.portedFrom)) errors.push({ code: 'PORTED', message });
  if (doc.meta.portedFrom && kind !== 'engine') files.push({ path: `${commonRoot(slug)}/ported_from.txt`, text: portedText(doc.meta.portedFrom, doc.meta.name, v.author) });
  return {
    bundle: { slug, projectName: doc.meta.name, files, copies },
    report: { errors, warnings },
    summary: { parts: files.filter((f) => f.path.endsWith('.jbeam')).length, meshes: v.meshCount, nodes: 0, beams: 0, textures: copies.length, daeBytes: v.dae.length },
  };
}

/** This mod's textures go into the export as DDS (the mod's own choice, else Settings → Export). */
export function ddsWanted(doc: Pick<Project, 'meta'>): boolean {
  return doc.meta.ddsConvert ?? useSettingsStore.getState().settings?.ddsConvert ?? false;
}

/**
 * The bundle as the writer takes it: textures marked for DDS are converted
 * here (each a file of its own), the rest copied as they are. A texture that
 * can't be converted is copied unchanged under its original extension, and
 * the materials pointing at it are fixed up.
 */
export async function finalBundle(prepared: PreparedExport['bundle'], progress: (text: string) => void): Promise<ExportBundle> {
  // Materials of other cars the meshes use (a borrowed engine's): a car only loads its own folder's
  // and the common ones, so their definitions go in this mod's materials file.
  const { gameMaterials, ...bundle } = prepared;
  if (gameMaterials?.length) {
    const defs = await call('beamng:gameMaterialDefs', { names: gameMaterials }).catch(() => ({}));
    if (Object.keys(defs).length) bundle.files = bundle.files.map((f) => (f.text !== undefined && f.path.endsWith('/main.materials.json') ? { ...f, text: `${JSON.stringify({ ...defs, ...(JSON.parse(f.text) as object) }, null, 2)}\n` } : f));
  }
  const todo = bundle.copies.filter((c) => c.convert);
  if (!todo.length) return { ...bundle, copies: bundle.copies.map(({ from, to }) => ({ from, to })) };
  const s = useSettingsStore.getState().settings;
  const opts = { mipmaps: s?.ddsMipmaps ?? true, normalFormat: s?.ddsNormalFormat ?? 'BC3', maxSize: s?.ddsMaxSize ?? 0 } as const;
  const files = [...bundle.files];
  const copies: { from: string; to: string }[] = bundle.copies.filter((c) => !c.convert).map(({ from, to }) => ({ from, to }));
  const renamed = new Map<string, string>();
  let n = 0;
  for (const c of todo) {
    progress(`Converting textures to DDS (${++n} of ${todo.length})…`);
    try {
      const bytes = await textureToDds(c.from, c.convert!, opts);
      files.push({ path: c.to, base64: toBase64(bytes) });
    } catch (err) {
      const original = `${c.to.slice(0, c.to.lastIndexOf('.'))}${c.from.slice(c.from.lastIndexOf('.'))}`;
      logger.warn(`kept ${c.from} as it is: ${errorText(err)}`);
      copies.push({ from: c.from, to: original });
      renamed.set(c.to.slice(c.to.lastIndexOf('/') + 1), original.slice(original.lastIndexOf('/') + 1));
    }
  }
  const fixed = renamed.size ? files.map((f) => (f.text && f.path.endsWith('.materials.json') ? { ...f, text: [...renamed].reduce((t, [a, b]) => t.split(a).join(b), f.text) } : f)) : files;
  return { ...bundle, files: fixed, copies };
}


export async function runExport(mode: 'install' | 'zip'): Promise<void> {
  const ui = useExportUi.getState();
  const prepared = ui.prepared;
  if (!prepared || prepared.report.errors.length) return;
  ui.set({ busy: mode === 'install' ? 'Installing into BeamNG…' : 'Writing zip…', error: null, errorDetail: null });
  try {
    const bundle = await finalBundle(prepared.bundle, (busy) => ui.set({ busy }));
    ui.set({ busy: mode === 'install' ? 'Installing into BeamNG…' : 'Writing zip…' });
    const r = mode === 'install' ? await call('export:install', bundle) : await call('export:zip', bundle);
    if (r) {
      ui.set({ result: { ...r, mode } });
      logger.info(`export ${mode}: ${r.path}`);
      void stampGameVersion();
      if (useSettingsStore.getState().settings?.openFolderAfterExport) void call('export:reveal').catch(() => undefined);
    }
  } catch (err) {
    fail(mode === 'install' ? 'Export: install to BeamNG' : 'Export: save zip', err);
  } finally {
    useExportUi.getState().set({ busy: null });
  }
}

/** Write the repository package: the zip, its pictures and the listing text, in a folder the user picks. */
export async function runPublish(listing: PublishListing): Promise<void> {
  const ui = useExportUi.getState();
  const prepared = ui.prepared;
  if (!prepared || prepared.report.errors.length) return;
  ui.set({ busy: 'Writing the repository package…', error: null, errorDetail: null });
  try {
    const bundle = await finalBundle(prepared.bundle, (busy) => ui.set({ busy }));
    const r = await call('export:publish', { bundle, listing });
    if (r) {
      ui.set({ result: { ...r, mode: 'publish' } });
      if (useSettingsStore.getState().settings?.openFolderAfterExport) void call('export:reveal').catch(() => undefined);
      logger.info(`export publish: ${r.path}`);
    }
  } catch (err) {
    fail('Export: repository package', err);
  } finally {
    useExportUi.getState().set({ busy: null });
  }
}
