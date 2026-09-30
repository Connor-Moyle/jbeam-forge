import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Points, PointsMaterial } from 'three';
import { BEAMNG_TO_VIEW_ROTATION_X } from '@shared/coords';
import { resolveToken } from '@renderer/ui/tokens';

/**
 * Modelling (fork): the mesh being reshaped drawn Blender-style over the
 * car: its wireframe, its points (in point mode), and what is picked in the
 * accent colour. Everything in BeamNG space.
 */
export interface ModelView {
  key: string;
  mode: 'vertex' | 'edge' | 'face';
  /** Every point where it is shown, xyz. */
  shown: Float32Array;
  /** Points used by a face (the rest aren't drawn). */
  live: Uint8Array;
  /** Edges as point pairs. */
  edges: Int32Array;
  selPoints: readonly number[];
  selEdges: readonly (readonly [number, number])[];
  /** Picked faces' corners, xyz (three per face). */
  selFaces: Float32Array;
}

export class ModelOverlay {
  readonly root = new Group();
  private readonly wire: LineSegments;
  private readonly dots: Points;
  private readonly pickedDots: Points;
  private readonly pickedWire: LineSegments;
  private readonly pickedFaces: Mesh;

  constructor() {
    this.root.rotation.x = BEAMNG_TO_VIEW_ROTATION_X;
    this.root.renderOrder = 8;
    const accent = new Color(resolveToken('accent') || undefined);
    const ink = new Color(resolveToken('text-1') || undefined);
    this.wire = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: ink, transparent: true, opacity: 0.55 }));
    this.dots = new Points(new BufferGeometry(), new PointsMaterial({ color: ink, size: 5, sizeAttenuation: false }));
    this.pickedDots = new Points(new BufferGeometry(), new PointsMaterial({ color: accent, size: 9, sizeAttenuation: false, depthTest: false, transparent: true }));
    this.pickedWire = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: accent, depthTest: false, transparent: true }));
    this.pickedFaces = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.4, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.pickedDots.renderOrder = 9;
    this.pickedWire.renderOrder = 9;
    for (const o of [this.wire, this.dots, this.pickedDots, this.pickedWire, this.pickedFaces]) {
      o.raycast = () => undefined;
      o.frustumCulled = false;
      this.root.add(o);
    }
    this.root.visible = false;
  }

  set(view: ModelView | null): void {
    this.root.visible = !!view;
    if (!view) {
      for (const o of [this.wire, this.dots, this.pickedDots, this.pickedWire, this.pickedFaces]) put(o, new Float32Array(0));
      return;
    }
    const { shown, edges } = view;
    const at = (out: Float32Array, i: number, p: number) => {
      out[i] = shown[p * 3]!;
      out[i + 1] = shown[p * 3 + 1]!;
      out[i + 2] = shown[p * 3 + 2]!;
    };
    const wire = new Float32Array(edges.length * 3);
    for (let i = 0; i < edges.length; i++) at(wire, i * 3, edges[i]!);
    put(this.wire, wire);
    if (view.mode === 'vertex') {
      let n = 0;
      for (let p = 0; p < view.live.length; p++) if (view.live[p]) n++;
      const dots = new Float32Array(n * 3);
      let i = 0;
      for (let p = 0; p < view.live.length; p++) if (view.live[p]) at(dots, (i++) * 3, p);
      put(this.dots, dots);
    } else put(this.dots, new Float32Array(0));
    const picked = new Float32Array(view.selPoints.length * 3);
    view.selPoints.forEach((p, i) => at(picked, i * 3, p));
    put(this.pickedDots, picked);
    const pw = new Float32Array(view.selEdges.length * 6);
    view.selEdges.forEach(([a, b], i) => {
      at(pw, i * 6, a);
      at(pw, i * 6 + 3, b);
    });
    put(this.pickedWire, pw);
    put(this.pickedFaces, view.selFaces);
  }

  dispose(): void {
    for (const o of [this.wire, this.dots, this.pickedDots, this.pickedWire, this.pickedFaces]) {
      o.geometry.dispose();
      (o.material as { dispose(): void }).dispose();
    }
    this.root.removeFromParent();
  }
}

/** A fresh geometry each time (the old one's GPU buffers freed). */
function put(o: Mesh | LineSegments | Points, positions: Float32Array): void {
  o.geometry.dispose();
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  o.geometry = g;
}
