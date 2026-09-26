import { BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, MeshBasicMaterial, SphereGeometry } from 'three';
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
