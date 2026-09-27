/**
 * Local-only mesh cache for benchmarks: loads a DAE once through the app's own
 * importer (BeamNG space, world matrices baked) and stores every mesh's
 * triangles under scratch/. Game geometry never leaves scratch/.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

export interface CachedMesh {
  name: string;
  positions: Float32Array;
  index: Uint32Array;
}

function b64(a: ArrayBufferView): string {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
}

function unb64<T>(s: string, ctor: new (b: ArrayBuffer) => T): T {
  const buf = Buffer.from(s, 'base64');
  const copy = new ArrayBuffer(buf.length);
  new Uint8Array(copy).set(buf);
  return new ctor(copy);
}

export async function loadMeshCache(daePath: string, cachePath: string): Promise<CachedMesh[]> {
  if (existsSync(cachePath)) {
    const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as { name: string; p: string; i: string }[];
    return raw.map((m) => ({ name: m.name, positions: unb64(m.p, Float32Array), index: unb64(m.i, Uint32Array) }));
  }
  // The importer runs in a browser; give it the DOM bits ColladaLoader needs.
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
  g.Image = dom.window.Image;
  g.self = dom.window;
  const { loadIntoLoaderSpace } = await import('../../src/renderer/import/loaders');
  const { bakeMeshes, toBeamng } = await import('../../src/renderer/import/normalize');
  const { defaultSettings } = await import('../../src/renderer/import/pipeline');
  const started = Date.now();
  const { root } = await loadIntoLoaderSpace('dae', new Uint8Array(readFileSync(daePath)), 'model.dae', () => Promise.resolve(null));
  const meshes = toBeamng(bakeMeshes(root), 'bench', defaultSettings('dae'));
  const out: CachedMesh[] = meshes.map((m) => {
    const pos = m.geometry.getAttribute('position');
    const positions = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      positions[i * 3] = pos.getX(i);
      positions[i * 3 + 1] = pos.getY(i);
      positions[i * 3 + 2] = pos.getZ(i);
    }
    const idx = m.geometry.index;
    const index = idx ? Uint32Array.from(idx.array as ArrayLike<number>) : Uint32Array.from({ length: pos.count - (pos.count % 3) }, (_, i) => i);
    return { name: m.name, positions, index };
  });
  writeFileSync(cachePath, JSON.stringify(out.map((m) => ({ name: m.name, p: b64(m.positions), i: b64(m.index) }))));
  console.error(`mesh cache: ${out.length} meshes loaded in ${Date.now() - started} ms → ${cachePath}`);
  return out;
}
