import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { Project } from '@shared/project/schema';
import type { TaxonomyEntry } from '@shared/taxonomy/schema';
import { resolveToken } from '@renderer/ui/tokens';

/**
 * Generated structure drawn over the model: nodes as instanced spheres,
 * beams as line segments (edge = part category colour, brace = dimmer,
 * attach = warning colour). BeamNG space; lives under the viewport's
 * rotated root. Owns all its GPU resources.
 */

export interface StructureData {
  nodePositions: Float32Array;
  nodeColors: Float32Array;
  beamPositions: Float32Array;
  beamColors: Float32Array;
}

const CATEGORY_TOKEN: Record<string, Parameters<typeof resolveToken>[0]> = {
  'Body & Structure': 'cat-body',
  Panels: 'cat-panel',
  'Bumpers & Aero': 'cat-panel',
  'Exterior Trim': 'cat-panel',
  Lights: 'cat-light',
  Glass: 'cat-glass',
  Interior: 'cat-interior',
  Mechanical: 'cat-mechanical',
};

/** Flatten the document's structure into GPU-ready arrays. */
export function structureData(doc: Pick<Project, 'nodes' | 'beams' | 'parts'>, entry: (id: string) => TaxonomyEntry | undefined): StructureData {
  const colorOf = new Map<string, Color>();
  const partColor = (partId: string) => {
    let c = colorOf.get(partId);
    if (!c) {
      const cat = entry(doc.parts.find((p) => p.id === partId)?.taxonomyId ?? '')?.category;
      c = new Color(resolveToken(CATEGORY_TOKEN[cat ?? ''] ?? 'cat-misc') || undefined);
      colorOf.set(partId, c);
    }
    return c;
  };
  const attach = new Color(resolveToken('warning') || undefined);
  const pos = new Map<string, [number, number, number]>();
  const nodePositions = new Float32Array(doc.nodes.length * 3);
  const nodeColors = new Float32Array(doc.nodes.length * 3);
  doc.nodes.forEach((n, i) => {
    pos.set(n.id, n.pos);
    nodePositions.set(n.pos, i * 3);
    const c = partColor(n.partId);
    nodeColors.set([c.r, c.g, c.b], i * 3);
  });
  const beamPositions: number[] = [];
  const beamColors: number[] = [];
  for (const b of doc.beams) {
    const a = pos.get(b.id1);
    const c = pos.get(b.id2);
    if (!a || !c) continue;
    beamPositions.push(...a, ...c);
    const col = b.kind === 'attach' ? attach : partColor(b.partId);
    const k = b.kind === 'brace' ? 0.45 : 1;
    for (let i = 0; i < 2; i++) beamColors.push(col.r * k, col.g * k, col.b * k);
  }
  return { nodePositions, nodeColors, beamPositions: new Float32Array(beamPositions), beamColors: new Float32Array(beamColors) };
}

export class StructureOverlay {
  readonly root = new Group();
  private nodes: InstancedMesh | null = null;
  private beams: LineSegments | null = null;
  private readonly sphere = new SphereGeometry(1, 8, 6);
  private readonly nodeMaterial = new MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.95 });
  private readonly beamMaterial = new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 });

  constructor() {
    this.root.renderOrder = 3;
  }

  set(data: StructureData | null, nodeRadius: number): void {
    this.clear();
    if (!data || data.nodePositions.length === 0) return;
    const count = data.nodePositions.length / 3;
    const nodes = new InstancedMesh(this.sphere, this.nodeMaterial, count);
    const m = new Matrix4();
    const c = new Color();
    for (let i = 0; i < count; i++) {
      m.makeScale(nodeRadius, nodeRadius, nodeRadius).setPosition(data.nodePositions[i * 3]!, data.nodePositions[i * 3 + 1]!, data.nodePositions[i * 3 + 2]!);
      nodes.setMatrixAt(i, m);
      nodes.setColorAt(i, c.setRGB(data.nodeColors[i * 3]!, data.nodeColors[i * 3 + 1]!, data.nodeColors[i * 3 + 2]!));
    }
    nodes.renderOrder = 4;
    nodes.frustumCulled = false;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.beamPositions, 3));
    g.setAttribute('color', new BufferAttribute(data.beamColors, 3));
    const beams = new LineSegments(g, this.beamMaterial);
    beams.renderOrder = 3;
    beams.frustumCulled = false;
    this.nodes = nodes;
    this.beams = beams;
    this.root.add(beams, nodes);
  }

  private clear(): void {
    if (this.nodes) {
      this.root.remove(this.nodes);
      this.nodes.dispose();
      this.nodes = null;
    }
    if (this.beams) {
      this.root.remove(this.beams);
      this.beams.geometry.dispose();
      this.beams = null;
    }
  }

  dispose(): void {
    this.clear();
    this.sphere.dispose();
    this.nodeMaterial.dispose();
    this.beamMaterial.dispose();
  }
}

/**
 * Live physics view (Test Mode): the same node/beam drawing, updated in place
 * every frame from the solver, beams coloured by stress (|force| / strength):
 * success → warning → danger. Broken beams are hidden.
 */
export class LiveOverlay {
  readonly root = new Group();
  private nodes: InstancedMesh | null = null;
  private beams: LineSegments | null = null;
  private beamA: Uint32Array | null = null;
  private beamB: Uint32Array | null = null;
  private readonly sphere = new SphereGeometry(1, 8, 6);
  private readonly nodeMaterial = new MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.95 });
  private readonly beamMaterial = new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });
  private readonly low = new Color(resolveToken('success') || undefined);
  private readonly mid = new Color(resolveToken('warning') || undefined);
  private readonly high = new Color(resolveToken('danger') || undefined);
  private readonly nodeColor = new Color(resolveToken('text-0') || undefined);
  private radius = 0.012;
  private key: unknown = null;
  private readonly obstacleRoot = new Group();
  private readonly obstacleMaterial = new MeshBasicMaterial({ color: new Color(resolveToken('text-2') || undefined), transparent: true, opacity: 0.45, depthWrite: false });
  private obstacleKey: unknown = null;

  constructor() {
    this.root.renderOrder = 5;
    this.root.add(this.obstacleRoot);
  }

  /** Crash-scenario obstacles: poles as cylinders, walls as thin boxes (BeamNG space, Z up). */
  setObstacles(obstacles: readonly { kind: 'pole' | 'wall'; x: number; y: number; radius?: number; nx?: number; ny?: number; halfWidth?: number }[] | undefined, height: number): void {
    if (obstacles === this.obstacleKey) return;
    this.obstacleKey = obstacles;
    for (const c of [...this.obstacleRoot.children]) {
      this.obstacleRoot.remove(c);
      (c as Mesh).geometry.dispose();
    }
    for (const o of obstacles ?? []) {
      if (o.kind === 'pole') {
        const r = o.radius ?? 0.15;
        const mesh = new Mesh(new CylinderGeometry(r, r, height, 20), this.obstacleMaterial);
        mesh.rotation.x = Math.PI / 2; // cylinder axis Y → Z (up)
        mesh.position.set(o.x, o.y, height / 2);
        this.obstacleRoot.add(mesh);
      } else {
        const w = Number.isFinite(o.halfWidth ?? Infinity) ? (o.halfWidth ?? 1) * 2 : 8;
        const mesh = new Mesh(new BoxGeometry(w, 0.2, height), this.obstacleMaterial);
        mesh.position.set(o.x, o.y - 0.1 * (o.ny ?? 1), height / 2);
        mesh.rotation.z = Math.atan2(o.nx ?? 0, o.ny ?? 1);
        this.obstacleRoot.add(mesh);
      }
    }
  }

  /** Rebuild buffers when the model changes; otherwise update in place. */
  update(model: { beamA: Uint32Array; beamB: Uint32Array; mass: Float64Array } | null, positions: Float32Array | null, stress: Float32Array | null, radius: number): void {
    if (!model || !positions) {
      this.clear();
      return;
    }
    if (this.key !== model) {
      this.clear();
      this.key = model;
      this.radius = radius;
      this.beamA = model.beamA;
      this.beamB = model.beamB;
      const n = model.mass.length;
      this.nodes = new InstancedMesh(this.sphere, this.nodeMaterial, n);
      this.nodes.frustumCulled = false;
      for (let i = 0; i < n; i++) this.nodes.setColorAt(i, this.nodeColor);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(model.beamA.length * 6), 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(model.beamA.length * 6), 3));
      this.beams = new LineSegments(g, this.beamMaterial);
      this.beams.frustumCulled = false;
      this.root.add(this.beams, this.nodes);
    }
    const nodes = this.nodes!;
    const m = new Matrix4();
    const r = this.radius;
    for (let i = 0; i < nodes.count; i++) {
      m.makeScale(r, r, r).setPosition(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
      nodes.setMatrixAt(i, m);
    }
    nodes.instanceMatrix.needsUpdate = true;
    const pos = this.beams!.geometry.getAttribute('position') as BufferAttribute;
    const col = this.beams!.geometry.getAttribute('color') as BufferAttribute;
    const pa = pos.array as Float32Array;
    const ca = col.array as Float32Array;
    const c = new Color();
    for (let b = 0; b < this.beamA!.length; b++) {
      const a = this.beamA![b]! * 3;
      const e = this.beamB![b]! * 3;
      const s = stress ? stress[b]! : 0;
      if (s < 0) {
        // Broken: collapse to a point so it disappears.
        for (let k = 0; k < 6; k++) pa[b * 6 + k] = positions[a + (k % 3)]!;
        continue;
      }
      pa.set([positions[a]!, positions[a + 1]!, positions[a + 2]!, positions[e]!, positions[e + 1]!, positions[e + 2]!], b * 6);
      const t = Math.min(1, s);
      if (t < 0.5) c.copy(this.low).lerp(this.mid, t * 2);
      else c.copy(this.mid).lerp(this.high, (t - 0.5) * 2);
      ca.set([c.r, c.g, c.b, c.r, c.g, c.b], b * 6);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /** Nearest node to a canvas point (px), within `maxPx`. */
  pickNode(project: (x: number, y: number, z: number) => [number, number] | null, positions: Float32Array, px: number, py: number, maxPx = 18): number | null {
    let best: number | null = null;
    let bd = maxPx;
    for (let i = 0; i < positions.length / 3; i++) {
      const p = project(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
      if (!p) continue;
      const d = Math.hypot(p[0] - px, p[1] - py);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private clear(): void {
    if (this.nodes) {
      this.root.remove(this.nodes);
      this.nodes.dispose();
      this.nodes = null;
    }
    if (this.beams) {
      this.root.remove(this.beams);
      this.beams.geometry.dispose();
      this.beams = null;
    }
    this.key = null;
  }

  dispose(): void {
    this.clear();
    this.setObstacles(undefined, 0);
    this.sphere.dispose();
    this.nodeMaterial.dispose();
    this.beamMaterial.dispose();
    this.obstacleMaterial.dispose();
  }
}
