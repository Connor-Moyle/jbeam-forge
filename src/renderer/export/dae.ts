import type { BufferGeometry } from 'three';

/**
 * COLLADA 1.4.1 writer for the exported vehicle (SPEC §4.2: "Export requires
 * DAE → a DAE writer converts non-DAE imports (and split results) with
 * UVs/normals/materials intact").
 *
 * - `Z_UP`, metres, identity node matrices: vertex data is written in BeamNG
 *   space exactly as the jbeam nodes are, which is what flexbodies need.
 * - One `<node name>` per exported mesh = the flexbody mesh name.
 * - Material ids/symbols = the (slug-prefixed) names `main.materials.json`
 *   maps to.
 * - Only the vertices a mesh actually uses are written (split results share
 *   their source's buffers).
 */

export interface DaeMesh {
  name: string;
  geometry: BufferGeometry;
  /** Exported material name per material index (geometry groups); index 0 when ungrouped. */
  materials: readonly string[];
  /** glTF UVs have a top-left origin: flip V for COLLADA's bottom-left. */
  flipV: boolean;
  /**
   * Two-sided materials: per material index, the material for the back faces
   * (null: none). Those triangles are written again, turned round, with it.
   */
  backMaterials?: readonly (string | null)[];
}

export interface DaeMaterial {
  name: string;
  color: [number, number, number, number];
}

const f = (n: number) => {
  const s = n.toFixed(6);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface Compacted {
  positions: number[];
  normals: number[];
  uv0: number[] | null;
  uv1: number[] | null;
  /** Per group: [materialIndex, local triangle vertex indices]. */
  groups: { material: number; indices: number[] }[];
}

function compactGeometry(g: BufferGeometry, flipV: boolean): Compacted {
  const pos = g.getAttribute('position');
  let nrm = g.getAttribute('normal');
  if (!nrm) {
    g.computeVertexNormals(); // only for sources that had none (e.g. some STL paths)
    nrm = g.getAttribute('normal');
  }
  const uvA = g.getAttribute('uv');
  const uvB = g.getAttribute('uv1');
  const index = g.index;
  const count = index ? index.count : pos.count - (pos.count % 3);
  const at = (i: number) => (index ? index.getX(i) : i);
  const groupRanges = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
  const remap = new Map<number, number>();
  const out: Compacted = { positions: [], normals: [], uv0: uvA ? [] : null, uv1: uvB ? [] : null, groups: [] };
  for (const gr of groupRanges) {
    const indices: number[] = [];
    const end = Math.min(count, gr.start + gr.count);
    for (let i = gr.start; i < end; i++) {
      const v = at(i);
      let local = remap.get(v);
      if (local === undefined) {
        local = remap.size;
        remap.set(v, local);
        out.positions.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        out.normals.push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
        if (uvA) out.uv0!.push(uvA.getX(v), flipV ? 1 - uvA.getY(v) : uvA.getY(v));
        if (uvB) out.uv1!.push(uvB.getX(v), flipV ? 1 - uvB.getY(v) : uvB.getY(v));
      }
      indices.push(local);
    }
    if (indices.length) out.groups.push({ material: gr.materialIndex ?? 0, indices });
  }
  return out;
}

function source(id: string, data: number[], stride: number, params: string[]): string {
  const acc = params.map((p) => `<param name="${p}" type="float"/>`).join('');
  return `<source id="${id}"><float_array id="${id}-array" count="${data.length}">${data.map(f).join(' ')}</float_array><technique_common><accessor source="#${id}-array" count="${data.length / stride}" stride="${stride}">${acc}</accessor></technique_common></source>`;
}

/** Back faces: each group with a back material again, wound the other way, on its own vertices with the normals reversed. */
function addBackFaces(c: Compacted, back: readonly (string | null)[], names: string[]): void {
  const dup = new Map<number, number>();
  const copy = (v: number) => {
    let d = dup.get(v);
    if (d !== undefined) return d;
    d = c.positions.length / 3;
    dup.set(v, d);
    c.positions.push(c.positions[v * 3]!, c.positions[v * 3 + 1]!, c.positions[v * 3 + 2]!);
    c.normals.push(-c.normals[v * 3]!, -c.normals[v * 3 + 1]!, -c.normals[v * 3 + 2]!);
    if (c.uv0) c.uv0.push(c.uv0[v * 2]!, c.uv0[v * 2 + 1]!);
    if (c.uv1) c.uv1.push(c.uv1[v * 2]!, c.uv1[v * 2 + 1]!);
    return d;
  };
  const front = c.groups.length;
  for (let g = 0; g < front; g++) {
    const gr = c.groups[g]!;
    const name = back[gr.material] ?? null;
    if (!name) continue;
    const indices: number[] = [];
    for (let t = 0; t + 2 < gr.indices.length; t += 3) indices.push(copy(gr.indices[t]!), copy(gr.indices[t + 2]!), copy(gr.indices[t + 1]!));
    names.push(name);
    c.groups.push({ material: -names.length, indices });
  }
}

/** Build the DAE text. Mesh names must already be unique and XML-safe (see exportMeshNames). */
export function writeDae(meshes: readonly DaeMesh[], materials: readonly DaeMaterial[], now = new Date()): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const effects = materials
    .map((m) => `<effect id="${esc(m.name)}-effect"><profile_COMMON><technique sid="common"><phong><diffuse><color sid="diffuse">${m.color.map(f).join(' ')}</color></diffuse></phong></technique></profile_COMMON></effect>`)
    .join('\n    ');
  const mats = materials.map((m) => `<material id="${esc(m.name)}" name="${esc(m.name)}"><instance_effect url="#${esc(m.name)}-effect"/></material>`).join('\n    ');
  const geometries: string[] = [];
  const nodes: string[] = [];
  for (const m of meshes) {
    const c = compactGeometry(m.geometry, m.flipV);
    if (!c.groups.length) continue;
    // Back-face groups get negative material numbers: -1 is backNames[0], and so on.
    const backNames: string[] = [];
    if (m.backMaterials?.some(Boolean)) addBackFaces(c, m.backMaterials, backNames);
    const nameOf = (material: number) => (material < 0 ? backNames[-material - 1]! : (m.materials[material] ?? m.materials[0] ?? ''));
    const id = `${esc(m.name)}-mesh`;
    const inputs = [`<input semantic="VERTEX" source="#${id}-vertices" offset="0"/>`, `<input semantic="NORMAL" source="#${id}-normals" offset="0"/>`];
    if (c.uv0) inputs.push(`<input semantic="TEXCOORD" source="#${id}-map-0" offset="0" set="0"/>`);
    if (c.uv1) inputs.push(`<input semantic="TEXCOORD" source="#${id}-map-1" offset="0" set="1"/>`);
    const tris = c.groups.map((gr) => {
      const mat = nameOf(gr.material);
      return `<triangles material="${esc(mat)}" count="${gr.indices.length / 3}">${inputs.join('')}<p>${gr.indices.join(' ')}</p></triangles>`;
    });
    geometries.push(
      `<geometry id="${id}" name="${esc(m.name)}"><mesh>${source(`${id}-positions`, c.positions, 3, ['X', 'Y', 'Z'])}${source(`${id}-normals`, c.normals, 3, ['X', 'Y', 'Z'])}${c.uv0 ? source(`${id}-map-0`, c.uv0, 2, ['S', 'T']) : ''}${c.uv1 ? source(`${id}-map-1`, c.uv1, 2, ['S', 'T']) : ''}<vertices id="${id}-vertices"><input semantic="POSITION" source="#${id}-positions"/></vertices>${tris.join('')}</mesh></geometry>`,
    );
    const used = [...new Set(c.groups.map((gr) => nameOf(gr.material)))].filter(Boolean);
    const bind = used.map((mat) => `<instance_material symbol="${esc(mat)}" target="#${esc(mat)}"><bind_vertex_input semantic="UVMap" input_semantic="TEXCOORD" input_set="0"/></instance_material>`).join('');
    nodes.push(
      `<node id="${esc(m.name)}" name="${esc(m.name)}" type="NODE"><matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix><instance_geometry url="#${id}" name="${esc(m.name)}"><bind_material><technique_common>${bind}</technique_common></bind_material></instance_geometry></node>`,
    );
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><authoring_tool>JBeam Forge</authoring_tool></contributor>
    <created>${stamp}</created>
    <modified>${stamp}</modified>
    <unit name="meter" meter="1"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_effects>
    ${effects}
  </library_effects>
  <library_materials>
    ${mats}
  </library_materials>
  <library_geometries>
    ${geometries.join('\n    ')}
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      ${nodes.join('\n      ')}
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#Scene"/>
  </scene>
</COLLADA>
`;
}
