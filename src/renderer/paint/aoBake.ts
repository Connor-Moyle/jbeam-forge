import { CanvasTexture, DoubleSide, NoColorSpace, Ray, Vector3, type BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { create } from 'zustand';
import { aoValue, dilate, hemisphere, orient, type Vec3 } from '@shared/paints/ao';
import { rasterizeMesh } from '@shared/paints/patterns';
import { projectStore } from '@renderer/app/stores/project';
import { useSceneStore } from '@renderer/app/stores/scene';
import { call } from '@renderer/diagnostics/ipc';
import { setTexture } from '@renderer/materials/commands';
import { provideTexture } from '@renderer/materials/runtime';
import { slotsOf } from '@renderer/materials/seed';
import { canvasPng } from './commands';
import { flat, meshesOfMaterial } from './painter';

/**
 * Bake ambient occlusion into a material's AO map: for every texel of the
 * meshes wearing it, rays go out over the surface's hemisphere and count
 * how much of the car (every visible mesh) blocks them within reach. Creases,
 * panel gaps and the insides of arches darken; open panels stay white. The
 * result is a real texture, so the game shows it too.
 */

export interface AoOptions {
  /** Texture size in pixels (square). */
  size: number;
  /** Rays per texel. */
  samples: number;
  /** How far (metres) a surface looks for things that shade it. */
  distance: number;
  /** 1 = a fully enclosed spot goes black; lower keeps it lighter. */
  strength: number;
}

export const DEFAULT_AO: AoOptions = { size: 512, samples: 24, distance: 0.3, strength: 1 };

export const useAoBake = create<{ busy: string | null; progress: number }>(() => ({ busy: null, progress: 0 }));

/** The triangle corners (as an index) of a mesh's material groups that wear `materialId`. */
function trianglesWearing(key: string, g: BufferGeometry, materialId: string): number[] | null {
  const d = projectStore.getState().doc;
  const slots = d ? (slotsOf(d, key) ?? []) : [];
  const index = g.index;
  const total = index ? index.count : g.getAttribute('position').count;
  const at = (i: number) => (index ? index.getX(i) : i);
  const groups = g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }];
  const out: number[] = [];
  for (const grp of groups) {
    if (slots[grp.materialIndex ?? 0] !== materialId) continue;
    const end = Math.min(total, grp.start + grp.count);
    for (let i = grp.start; i < end; i++) out.push(at(i));
  }
  return out.length ? out : null;
}

function bvhOf(g: BufferGeometry): MeshBVH {
  if (g.boundsTree instanceof MeshBVH) return g.boundsTree;
  const bvh = new MeshBVH(g, { indirect: true });
  g.boundsTree = bvh;
  return bvh;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Bake and assign the AO map; resolves to the saved file (null when the material is on no loaded mesh with UVs). */
export async function bakeAmbientOcclusion(materialId: string, opts: AoOptions = DEFAULT_AO): Promise<string | null> {
  const d = projectStore.getState().doc;
  if (!d || useAoBake.getState().busy) return null;
  const def = d.materials.find((m) => m.id === materialId);
  if (!def) return null;
  useAoBake.setState({ busy: materialId, progress: 0 });
  try {
    const W = opts.size;
    const H = opts.size;
    // 1. Where every texel sits on the car, and which way it faces.
    const pos = new Float32Array(W * H * 3);
    const nrm = new Float32Array(W * H * 3);
    const mask = new Uint8Array(W * H);
    let flipY = true;
    for (const m of meshesOfMaterial(materialId)) {
      const g = m.geometry;
      const P = g.getAttribute('position');
      const U = g.getAttribute('uv');
      if (!P || !U) continue;
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const index = trianglesWearing(m.key, g, materialId);
      if (!index) continue;
      flipY = m.flipY;
      rasterizeMesh({ positions: flat(P, 3), uvs: flat(U, 2), index, normals: flat(g.getAttribute('normal'), 3) }, { width: W, height: H, flipY: m.flipY }, (x, y, p, n) => {
        const i = y * W + x;
        pos.set(p, i * 3);
        if (n) nrm.set(n, i * 3);
        mask[i] = 1;
      });
    }
    const texels: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) texels.push(i);
    if (!texels.length) return null;

    // 2. What can shade it: every visible mesh.
    const hidden = useSceneStore.getState().hidden;
    const occluders: MeshBVH[] = [];
    for (const src of Object.values(useSceneStore.getState().sources)) for (const m of src.meshes) if (!hidden[m.key]) occluders.push(bvhOf(m.geometry));

    // 3. Rays.
    const dirs = hemisphere(opts.samples);
    const ray = new Ray();
    const values = new Float32Array(W * H).fill(1);
    const bias = Math.min(0.002, opts.distance * 0.01);
    let last = performance.now();
    for (let k = 0; k < texels.length; k++) {
      const i = texels[k]!;
      const n: Vec3 = [nrm[i * 3]!, nrm[i * 3 + 1]!, nrm[i * 3 + 2]!];
      const o = new Vector3(pos[i * 3]! + n[0] * bias, pos[i * 3 + 1]! + n[1] * bias, pos[i * 3 + 2]! + n[2] * bias);
      let blocked = 0;
      for (const d0 of dirs) {
        const dir = orient(d0, n);
        ray.origin.copy(o);
        ray.direction.set(dir[0], dir[1], dir[2]);
        for (const b of occluders) {
          if (b.raycastFirst(ray, DoubleSide, 0, opts.distance)) {
            blocked++;
            break;
          }
        }
      }
      values[i] = aoValue(blocked / dirs.length, opts.strength);
      if (performance.now() - last > 40) {
        useAoBake.setState({ progress: k / texels.length });
        await tick();
        last = performance.now();
      }
    }
    dilate(values, mask, W, H, 8);

    // 4. The texture: grey in every channel (three.js reads red, BeamNG the whole image).
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g2 = canvas.getContext('2d')!;
    const img = g2.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const v = Math.round((mask[i] ? values[i]! : 1) * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g2.putImageData(img, 0, 0);
    const path = await call('materials:saveTexture', { name: `${d.meta.slug}_${def.id}_ao.png`, bytes: await canvasPng(canvas) });
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = NoColorSpace;
    tex.flipY = flipY;
    provideTexture(path, tex);
    setTexture(def.id, 0, 'ambientOcclusionMap', path);
    return path;
  } finally {
    useAoBake.setState({ busy: null, progress: 0 });
  }
}
