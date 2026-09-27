import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshStandardMaterial, TextureLoader, type LoadingManager, type Object3D, type Texture } from 'three';
import { parseKn5, type Kn5Material, type Kn5Node } from '@shared/kn5/parse';

/**
 * Assetto Corsa kn5 → loader space. Textures come in as placeholders named
 * after the embedded texture; main extracts the embedded images to a cache
 * folder that the texture pass searches (src/main/import/kn5Textures.ts).
 * Positions, winding and matrices are used as stored: badges and dash text
 * read the right way round without any mirroring.
 */

/** AC's Blinn-Phong exponent as a PBR roughness (roughly: sharper highlight, smoother surface). */
export function roughnessFromSpecularExp(exp: number): number {
  return Math.min(1, Math.max(0.05, Math.sqrt(2 / (Math.max(0, exp) + 2))));
}

function buildMaterial(m: Kn5Material, loader: TextureLoader): MeshStandardMaterial {
  const tex = (name: string | undefined): Texture | null => {
    if (!name) return null;
    const t = loader.load(name);
    t.flipY = false; // DirectX UVs, v = 0 at the top
    return t;
  };
  const prop = (k: string) => m.props[k];
  const diffuse = m.samplers.txDiffuse;
  const normal = m.samplers.txNormal;
  const emissive = prop('ksEmissive')?.c ?? [0, 0, 0];
  const glows = emissive.some((v) => v > 0);
  const glass = /glass/i.test(m.shader) || /glass/i.test(m.name);
  // AC lights a surface by texture × (ambient + diffuse); their sum is how bright the base shows.
  const brightness = Math.min(1, Math.max(0.05, (prop('ksAmbient')?.a ?? 0.5) + (prop('ksDiffuse')?.a ?? 0.5)));
  const material = new MeshStandardMaterial({
    name: m.name,
    color: new Color(brightness, brightness, brightness),
    roughness: roughnessFromSpecularExp(prop('ksSpecularEXP')?.a ?? 16),
    metalness: /chrome/i.test(m.name) ? 1 : 0,
    transparent: m.blendMode === 1 || glass,
    opacity: glass && !diffuse ? 0.35 : 1,
    alphaTest: m.alphaTested ? prop('ksAlphaRef')?.a || 0.5 : 0,
    side: glass ? DoubleSide : undefined,
  });
  material.map = tex(diffuse);
  if (m.blendMode === 1 && diffuse) material.userData.alphaFromTexture = true;
  // Some materials point the normal slot at the diffuse image; that isn't a normal map.
  if (normal && normal !== diffuse) material.normalMap = tex(normal);
  // Multi-map shaders colour the diffuse with the detail texture where the diffuse alpha is low
  // (a Kunos car's paint colour lives in metal_detail.dds). The detail rides in the emissive slot
  // until the texture pass has loaded it; acBake.ts then bakes the two into one texture.
  const detail = m.samplers.txDetail;
  if (/multimap/i.test(m.shader) && diffuse && detail && (prop('useDetail')?.a ?? 1) > 0 && !glows) {
    material.emissiveMap = tex(detail);
    material.userData.acDetail = { uvScale: prop('detailUVMultiplier')?.a || 1 };
  }
  if (glows) {
    // AC multiplies emissive by the diffuse texture; values run well past 1, so compress them.
    const peak = Math.max(...emissive);
    material.emissive = new Color(emissive[0] / peak, emissive[1] / peak, emissive[2] / peak);
    material.emissiveIntensity = 0.5 + Math.log10(1 + peak);
    material.emissiveMap = tex(diffuse);
  }
  return material;
}

function buildGeometry(node: Extract<Kn5Node, { kind: 'mesh' }>): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(node.positions, 3));
  g.setAttribute('normal', new BufferAttribute(node.normals, 3));
  g.setAttribute('uv', new BufferAttribute(node.uvs, 2));
  g.setIndex(new BufferAttribute(node.indices, 1));
  return g;
}

export function loadKn5(bytes: Uint8Array, manager: LoadingManager): Object3D {
  const kn5 = parseKn5(bytes, { withTextures: false });
  const loader = new TextureLoader(manager);
  const materials = kn5.materials.map((m) => buildMaterial(m, loader));
  const fallback = new MeshStandardMaterial({ name: 'kn5_default', roughness: 0.6 });

  const build = (node: Kn5Node): Object3D => {
    let obj: Object3D;
    if (node.kind === 'group') {
      obj = new Group();
      obj.matrix.fromArray(node.matrix);
      obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    } else {
      obj = new Mesh(buildGeometry(node), materials[node.material] ?? fallback);
      obj.visible = node.visible;
    }
    obj.name = node.name;
    for (const child of node.children) obj.add(build(child));
    return obj;
  };
  return build(kn5.root);
}
