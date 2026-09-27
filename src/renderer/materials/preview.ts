import {
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  TorusKnotGeometry,
  WebGLRenderer,
  type BufferGeometry,
  type Object3D,
  type Material,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { MaterialDef } from '@shared/materials/schema';
import { resolveToken } from '@renderer/ui/tokens';
import { materialFor, texturesReady } from './runtime';
import type { SourceFormat } from '@shared/project/schema';
import { call } from '@renderer/diagnostics/ipc';
import { loadIntoLoaderSpace } from '@renderer/import/loaders';
import { loadTextured } from '@renderer/import/pipeline';
import { disposeMaterials } from '@renderer/import/dispose';

/**
 * Material previews: a live stage for the Materials editor (orbit it, pick a
 * shape and a background, every edit shows immediately) and small rendered
 * thumbnails for lists, made one at a time on a shared offscreen renderer.
 */

export const PREVIEW_SHAPES = ['sphere', 'cube', 'panel', 'cylinder', 'knot'] as const;
export type PreviewShape = (typeof PREVIEW_SHAPES)[number];
export const PREVIEW_BACKGROUNDS = ['studio', 'dark', 'light', 'checker', 'sky'] as const;
export type PreviewBackground = (typeof PREVIEW_BACKGROUNDS)[number];

function shapeGeometry(shape: PreviewShape): BufferGeometry {
  switch (shape) {
    case 'cube':
      return new BoxGeometry(1.35, 1.35, 1.35);
    case 'panel':
      return new PlaneGeometry(2, 2);
    case 'cylinder':
      return new CylinderGeometry(0.75, 0.75, 1.6, 64);
    case 'knot':
      return new TorusKnotGeometry(0.6, 0.22, 200, 32);
    default:
      return new SphereGeometry(1, 96, 48);
  }
}

/** A background: a flat colour, a vertical gradient or a checker, drawn into a small canvas texture. */
function backgroundTexture(bg: PreviewBackground): Texture | Color {
  if (bg === 'dark') return new Color(resolveToken('preview-dark'));
  if (bg === 'light') return new Color(resolveToken('preview-light'));
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  if (bg === 'checker') {
    const cell = 32;
    for (let y = 0; y < 256; y += cell)
      for (let x = 0; x < 256; x += cell) {
        ctx.fillStyle = resolveToken((x + y) / cell % 2 ? 'preview-checker-a' : 'preview-checker-b');
        ctx.fillRect(x, y, cell, cell);
      }
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, resolveToken(bg === 'sky' ? 'preview-sky-top' : 'preview-studio-top'));
    g.addColorStop(1, resolveToken(bg === 'sky' ? 'preview-sky-bottom' : 'preview-studio-bottom'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Scene + camera + lighting shared by the live stage and the thumbnail renderer. */
function makeScene(renderer: WebGLRenderer): { scene: Scene; camera: PerspectiveCamera; mesh: Mesh; dispose: () => void } {
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environment = env;
  const key = new DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 4, 5);
  scene.add(key);
  const camera = new PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 0.35, 4.2);
  camera.lookAt(0, 0, 0);
  const mesh = new Mesh(shapeGeometry('sphere'));
  scene.add(mesh);
  return {
    scene,
    camera,
    mesh,
    dispose: () => {
      env.dispose();
      mesh.geometry.dispose();
    },
  };
}

/** The live preview in the Materials editor. */
export class MaterialStage {
  private readonly renderer: WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly parts: ReturnType<typeof makeScene>;
  private background: Texture | Color | null = null;
  private frame = 0;
  private readonly resize: ResizeObserver;
  autoRotate = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.parts = makeScene(this.renderer);
    this.controls = new OrbitControls(this.parts.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 9;
    this.controls.addEventListener('start', () => (this.autoRotate = false));
    this.setBackground('studio');
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
    this.fit();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      if (this.autoRotate) this.parts.mesh.rotation.y += 0.004;
      this.controls.update();
      this.renderer.render(this.parts.scene, this.parts.camera);
    };
    loop();
  }

  private fit(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.parts.camera.aspect = w / h;
    this.parts.camera.updateProjectionMatrix();
  }

  setMaterial(material: Material): void {
    this.parts.mesh.material = material;
  }

  setShape(shape: PreviewShape): void {
    this.parts.mesh.geometry.dispose();
    this.parts.mesh.geometry = shapeGeometry(shape);
  }

  setBackground(bg: PreviewBackground): void {
    if (this.background && !(this.background instanceof Color)) this.background.dispose();
    this.background = backgroundTexture(bg);
    this.parts.scene.background = this.background;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    if (this.background && !(this.background instanceof Color)) this.background.dispose();
    this.parts.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

// ---------------------------------------------------------------- thumbnails

const THUMB = 128;
let thumbRenderer: { renderer: WebGLRenderer; parts: ReturnType<typeof makeScene>; shape: PreviewShape } | null = null;
const thumbs = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

/** The one offscreen renderer every thumbnail uses (made on first need). */
function ensureThumbRenderer(): NonNullable<typeof thumbRenderer> {
  if (!thumbRenderer) {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB;
    canvas.height = THUMB;
    const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(THUMB, THUMB, false);
    const parts = makeScene(renderer);
    parts.scene.background = backgroundTexture('studio');
    thumbRenderer = { renderer, parts, shape: 'sphere' };
  }
  return thumbRenderer;
}

function thumbKey(def: MaterialDef, shape: PreviewShape): string {
  const { id: _id, name: _name, origin: _origin, ...look } = def;
  return `${shape}:${JSON.stringify(look)}`;
}

/**
 * A rendered preview of a material (PNG data URL), waiting for its textures
 * first. Identical-looking materials share one render; renders run one at a
 * time so a long list can't flood the GPU.
 */
export function materialThumbnail(def: MaterialDef, shape: PreviewShape = 'sphere'): Promise<string> {
  const key = thumbKey(def, shape);
  const known = thumbs.get(key);
  if (known) return known;
  const job = queue.then(async () => {
    await texturesReady(def);
    const t = ensureThumbRenderer();
    if (t.shape !== shape) {
      t.parts.mesh.geometry.dispose();
      t.parts.mesh.geometry = shapeGeometry(shape);
      t.shape = shape;
    }
    t.parts.mesh.material = materialFor(def);
    t.parts.mesh.rotation.set(0, shape === 'panel' ? 0 : 0.6, 0);
    t.renderer.render(t.parts.scene, t.parts.camera);
    return t.renderer.domElement.toDataURL('image/png');
  });
  queue = job.catch(() => undefined);
  thumbs.set(key, job);
  return job;
}

// ---------------------------------------------------------------- object thumbnails

const objectThumbs = new Map<string, Promise<string | null>>();

/**
 * A rendered preview of a library object (PNG data URL): its mesh loaded with
 * the importer's own loaders, dressed in its material, framed to fit.
 */
export function objectThumbnail(item: { id: string; mesh: string; material: MaterialDef | null }): Promise<string | null> {
  const known = objectThumbs.get(item.id);
  if (known) return known;
  const job = queue.then(async () => {
    const ext = item.mesh.slice(item.mesh.lastIndexOf('.') + 1).toLowerCase() as SourceFormat;
    let root: Object3D;
    if (item.material) {
      const bytes = await call('import:readFile', { path: item.mesh });
      root = (await loadIntoLoaderSpace(ext, bytes, item.mesh, () => Promise.resolve(null))).root;
      await texturesReady(item.material);
      const material = materialFor(item.material);
      root.traverse((o) => {
        if (o instanceof Mesh) o.material = material;
      });
    } else {
      // Brings its own materials (kn5): load them with their textures.
      root = new Group();
      for (const m of await loadTextured(item.mesh, ext)) root.add(new Mesh(m.geometry, m.material));
    }
    // Three-quarter view of whatever the object is, sized to fill the frame.
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const sphere = box.getBoundingSphere(new Sphere());
    root.position.sub(sphere.center);
    const holder = new Group();
    holder.add(root);
    holder.scale.setScalar(1.25 / (sphere.radius || 1));
    holder.rotation.set(0.35, -0.75, 0);
    const t = ensureThumbRenderer();
    t.parts.mesh.visible = false;
    t.parts.scene.add(holder);
    t.renderer.render(t.parts.scene, t.parts.camera);
    const url = t.renderer.domElement.toDataURL('image/png');
    t.parts.scene.remove(holder);
    t.parts.mesh.visible = true;
    const own = new Set<Material>();
    holder.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      (o.geometry as BufferGeometry).dispose();
      for (const m of Array.isArray(o.material) ? (o.material as Material[]) : [o.material as Material]) own.add(m);
    });
    // Materials the object brought with it (not the shared project ones) go too, with their textures.
    if (!item.material) disposeMaterials(own);
    return url;
  });
  const safe = job.catch(() => null);
  queue = safe;
  objectThumbs.set(item.id, safe);
  return safe;
}
