import { readFileSync } from 'node:fs';

/** Load an FBX in Node (three's loader with a stub DOM); triangles in metres, ground at y = 0, +Y up, front +Z, left +X. */
export interface RefTri {
  mesh: string;
  mat: string;
  p: [number, number, number][];
  uv: [number, number][];
}

export async function loadFbx(path: string, unit = 0.01): Promise<RefTri[]> {
  const g = globalThis as Record<string, unknown>;
  g.self = globalThis;
  g.window = globalThis;
  g.document = { createElementNS: () => ({ style: {}, addEventListener() {}, getContext: () => null }), createElement: () => ({ style: {}, addEventListener() {}, getContext: () => null }) };
  const THREE = await import('three');
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  const warn = console.warn;
  console.warn = () => {};
  const buf = readFileSync(path);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  console.warn = warn;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const ground = box.min.y;
  const out: RefTri[] = [];
  root.traverse((o) => {
    const m = o as InstanceType<typeof THREE.Mesh>;
    if (!m.isMesh) return;
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    const v = new THREE.Vector3();
    for (const gr of groups) {
      const mat = (mats[gr.materialIndex ?? 0]?.name ?? 'none').replace(/^_?013014SSCR_?/, '');
      for (let i = gr.start; i + 2 < gr.start + gr.count; i += 3) {
        const p: [number, number, number][] = [];
        const t: [number, number][] = [];
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(pos, i + k).applyMatrix4(m.matrixWorld);
          p.push([v.x * unit, (v.y - ground) * unit, v.z * unit]);
          t.push(uv ? [uv.getX(i + k), uv.getY(i + k)] : [0, 0]);
        }
        out.push({ mesh: m.name, mat, p, uv: t });
      }
    }
  });
  return out;
}
