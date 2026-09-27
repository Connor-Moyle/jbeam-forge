import type { Material } from 'three';
import type { Box3Like } from '@shared/coords';
import type { SourceFormat } from '@shared/project/schema';
import { call } from '@renderer/diagnostics/ipc';
import { rlog } from '@renderer/diagnostics/logger';
import { loadIntoLoaderSpace } from './loaders';
import { bakeMeshes, boundsOf, toBeamng, triangleCount, type BakedMesh, type ImportedMesh, type ImportSettings } from './normalize';
import { bakeAcDetail } from './acBake';
import { applyTextures, ALL_CAPS, type GpuTextureCaps, type TextureReport } from './textures';

/**
 * Import in two stages so the import dialog can show real numbers before the
 * user commits:
 *   stage(): read + parse + bake world matrices (loader space) + bounds
 *   finish(): texture pass + convert to BeamNG space with the chosen settings
 */

const logger = rlog('import');

export interface StagedImport {
  path: string;
  fileName: string;
  format: SourceFormat;
  bytes: number;
  baked: BakedMesh[];
  /** Loader-space bounds; the dialog maps them through the chosen settings. */
  box: Box3Like | null;
  triangles: number;
  parseMs: number;
}

export interface FinishedImport {
  meshes: ImportedMesh[];
  textures: TextureReport;
  totalMs: number;
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i < 0 ? '' : path.slice(0, i);
}

/** Join a side-file reference onto the model's folder (refs may use / or \\). */
export function joinRef(dir: string, ref: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir}${sep}${ref.replace(/[\\/]+/g, sep).replace(/^[\\/]+/, '')}`;
}

export async function stageImport(path: string, format: SourceFormat): Promise<StagedImport> {
  const started = performance.now();
  const bytes = await call('import:readFile', { path });
  const dir = dirOf(path);
  const readSide = async (ref: string) => {
    try {
      return await call('import:readFile', { path: joinRef(dir, ref) });
    } catch {
      return null;
    }
  };
  const { root } = await loadIntoLoaderSpace(format, bytes, fileNameOf(path), readSide);
  const baked = bakeMeshes(root);
  if (baked.length === 0) throw new Error('The file contains no triangle meshes.');
  const parseMs = Math.round(performance.now() - started);
  const triangles = baked.reduce((n, m) => n + triangleCount(m.geometry), 0);
  logger.info(`staged ${fileNameOf(path)}: ${baked.length} meshes, ${triangles} triangles, ${(bytes.byteLength / 1e6).toFixed(1)} MB in ${parseMs} ms`);
  return { path, fileName: fileNameOf(path), format, bytes: bytes.byteLength, baked, box: boundsOf(baked), triangles, parseMs };
}

function uniqueMaterials(meshes: readonly BakedMesh[]): Material[] {
  const set = new Set<Material>();
  for (const m of meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) set.add(mat);
  return [...set];
}

export async function finishImport(
  staged: StagedImport,
  sourceId: string,
  settings: ImportSettings,
  textureDirs: readonly string[],
  caps: GpuTextureCaps = ALL_CAPS,
): Promise<FinishedImport> {
  const started = performance.now();
  const textures = await applyTextures(
    uniqueMaterials(staged.baked),
    {
      resolve: (refs) => call('import:resolveTextures', { sourcePath: staged.path, refs, textureDirs: [...textureDirs] }),
      read: (p) => call('import:readFile', { path: p }),
    },
    caps,
  );
  if (staged.format === 'kn5') await bakeAcDetail(staged.baked, staged.path);
  const meshes = toBeamng(staged.baked, sourceId, settings);
  const totalMs = Math.round(staged.parseMs + performance.now() - started);
  logger.info(
    `imported ${staged.fileName}: ${meshes.length} meshes, textures ${textures.loaded} loaded / ${textures.missing.length} missing / ${textures.unsupported.length} unsupported, ${totalMs} ms total`,
  );
  return { meshes, textures, totalMs };
}

/**
 * A model read with its own materials and textures, still in loader space
 * (for previews that don't import anything).
 */
export async function loadTextured(path: string, format: SourceFormat): Promise<BakedMesh[]> {
  const staged = await stageImport(path, format);
  await applyTextures(uniqueMaterials(staged.baked), {
    resolve: (refs) => call('import:resolveTextures', { sourcePath: path, refs, textureDirs: [] }),
    read: (p) => call('import:readFile', { path: p }),
  });
  if (format === 'kn5') await bakeAcDetail(staged.baked, path);
  return staged.baked;
}

/** Defaults per format (loader-space axes; see src/shared/coords.ts). */
export function defaultSettings(format: SourceFormat): ImportSettings {
  switch (format) {
    case 'stl':
      return { scale: 0.001, upAxis: '+z', forwardAxis: '-y' }; // STL is usually millimetres, Z up
    case 'fbx':
      return { scale: 0.01, upAxis: '+y', forwardAxis: '+z' }; // FBX is usually centimetres
    default:
      return { scale: 1, upAxis: '+y', forwardAxis: '+z' };
  }
}
