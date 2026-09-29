import { Box3, CanvasTexture, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector2, Vector3, type Object3D, type Texture, type WebGLRenderer } from 'three';

/**
 * Studio pictures of the car (fork), like the game's vehicle selector: the
 * car three-quarters on, on a seamless backdrop with a soft shadow under it,
 * lit by the viewport's studio reflections plus a key and fill light. Used
 * for the model's default.jpg and each configuration's picture.
 */

export const PREVIEW_ANGLES = [
  { value: 'front-left', label: 'Front three-quarter (left side)', yaw: 38, pitch: 12 },
  { value: 'front-right', label: 'Front three-quarter (right side)', yaw: -38, pitch: 12 },
  { value: 'front', label: 'Front', yaw: 0, pitch: 8 },
  { value: 'side', label: 'Side (left)', yaw: 90, pitch: 6 },
  { value: 'rear-left', label: 'Rear three-quarter (left side)', yaw: 142, pitch: 12 },
] as const;
export type PreviewAngle = (typeof PREVIEW_ANGLES)[number]['value'];

/** Backdrops: top and bottom of the gradient, and how dark the shadow is. */
export const PREVIEW_BACKDROPS = {
  studio: { label: 'Studio grey', top: '#c9ccd1', bottom: '#8e939b', shadow: 0.55 }, // token-lint-ignore: exported picture colours
  light: { label: 'Light', top: '#f2f3f5', bottom: '#c8cbd0', shadow: 0.4 }, // token-lint-ignore: exported picture colours
  dark: { label: 'Dark', top: '#3a3d43', bottom: '#15171a', shadow: 0.75 }, // token-lint-ignore: exported picture colours
  sunset: { label: 'Warm', top: '#e9c9a2', bottom: '#7d6a5c', shadow: 0.55 }, // token-lint-ignore: exported picture colours
} as const; // token-lint-ignore: picture colours for the exported image, not UI
export type PreviewBackdrop = keyof typeof PREVIEW_BACKDROPS;

export interface StudioOptions {
  width: number;
  height: number;
  angle: PreviewAngle;
  backdrop: PreviewBackdrop;
  /** Rendered this many times larger, then scaled down (smooth edges). */
  supersample?: number;
  quality?: number;
}

function gradient(top: string, bottom: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.62, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A soft shadow: the car's footprint, blurred. */
function shadowTexture(aspect: number): CanvasTexture {
  const w = 512;
  const h = Math.max(64, Math.round(512 / aspect));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const pad = 0.18;
  g.filter = `blur(${Math.round(w * 0.05)}px)`;
  g.fillStyle = '#000'; // token-lint-ignore: shadow pixels
  g.beginPath();
  g.roundRect(w * pad, h * pad, w * (1 - 2 * pad), h * (1 - 2 * pad), Math.min(w, h) * 0.2);
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The visible meshes' bounds in world space. */
export function visibleBounds(root: Object3D): Box3 {
  const box = new Box3();
  root.updateMatrixWorld(true);
  root.traverseVisible((o) => {
    if ((o as Mesh).isMesh) box.expandByObject(o, true);
  });
  return box;
}

/** Camera position for an angle: yaw from the car's front toward its left side, pitch above. */
export function studioCamera(box: Box3, angle: PreviewAngle, aspect: number, fov = 28): { position: Vector3; target: Vector3 } {
  const a = PREVIEW_ANGLES.find((x) => x.value === angle) ?? PREVIEW_ANGLES[0];
  const yaw = (a.yaw * Math.PI) / 180;
  const pitch = (a.pitch * Math.PI) / 180;
  // View space: the car's front is +Z, its left +X, up +Y.
  const dir = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
  const target = box.getCenter(new Vector3());
  target.y = box.min.y + (box.max.y - box.min.y) * 0.42;
  // Fit every corner of the box inside the frame, with a margin.
  const vfov = (fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), dir).normalize();
  const up = new Vector3().crossVectors(dir, right).normalize();
  let dist = 0;
  for (let i = 0; i < 8; i++) {
    const p = new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target);
    const depth = p.dot(dir);
    dist = Math.max(dist, depth + Math.abs(p.dot(right)) / Math.tan(hfov / 2) / 0.84, depth + Math.abs(p.dot(up)) / Math.tan(vfov / 2) / 0.8);
  }
  return { position: target.clone().addScaledVector(dir, Math.max(dist, 0.5)), target };
}

/**
 * Render `model` in the studio with `renderer` (its canvas is resized for the
 * shot and put back). Returns a JPEG data URL.
 */
export function renderStudio(renderer: WebGLRenderer, model: Object3D, environment: Texture | null, opts: StudioOptions): string | null {
  // Shown even while the viewport hides the mesh (Test Mode, mesh view off).
  const wasVisible = model.visible;
  model.visible = true;
  const box = visibleBounds(model);
  if (box.isEmpty()) {
    model.visible = wasVisible;
    return null;
  }
  const ss = Math.max(1, Math.min(opts.supersample ?? 2, Math.floor(renderer.capabilities.maxTextureSize / Math.max(opts.width, opts.height))));
  const W = opts.width * ss;
  const H = opts.height * ss;
  const back = PREVIEW_BACKDROPS[opts.backdrop] ?? PREVIEW_BACKDROPS.studio;

  const scene = new Scene();
  const bg = gradient(back.top, back.bottom);
  scene.background = bg;
  scene.environment = environment;
  scene.environmentIntensity = 1;
  const hemi = new HemisphereLight(new Color('#ffffff'), new Color(back.bottom), 1.4); // token-lint-ignore: studio light
  const key = new DirectionalLight(new Color('#ffffff'), 2.6); // token-lint-ignore: studio light
  key.position.set(3, 8, 6);
  const fill = new DirectionalLight(new Color('#dfe6ff'), 0.9); // token-lint-ignore: studio light
  fill.position.set(-6, 3, -2);
  const size = box.getSize(new Vector3());
  const shadowTex = shadowTexture(size.x / Math.max(size.z, 1e-3));
  const shadow = new Mesh(new PlaneGeometry(size.x * 1.5, size.z * 1.5), new MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: back.shadow, depthWrite: false, color: new Color('#000') })); // token-lint-ignore: shadow
  shadow.rotation.x = -Math.PI / 2;
  const c = box.getCenter(new Vector3());
  shadow.position.set(c.x, box.min.y + 0.002, c.z);
  const stage = new Group();
  stage.add(hemi, key, fill, shadow);
  scene.add(stage);

  const parent = model.parent;
  const camera = new PerspectiveCamera(28, W / H, 0.05, 500);
  const { position, target } = studioCamera(box, opts.angle, W / H, camera.fov);
  camera.position.copy(position);
  camera.lookAt(target);
  camera.near = Math.max(0.05, position.distanceTo(target) / 100);
  camera.updateProjectionMatrix();

  const oldRatio = renderer.getPixelRatio();
  const oldSize = renderer.getSize(new Vector2());
  const canvas = renderer.domElement;
  const oldW = canvas.width;
  const oldH = canvas.height;
  try {
    scene.add(model);
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.render(scene, camera);
    const out = document.createElement('canvas');
    out.width = opts.width;
    out.height = opts.height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, W, H, 0, 0, opts.width, opts.height);
    return out.toDataURL('image/jpeg', opts.quality ?? 0.9);
  } finally {
    model.visible = wasVisible;
    if (parent) parent.add(model);
    renderer.setPixelRatio(oldRatio);
    renderer.setSize(oldSize.x, oldSize.y, false);
    if (canvas.width !== oldW || canvas.height !== oldH) {
      canvas.width = oldW;
      canvas.height = oldH;
    }
    bg.dispose();
    shadowTex.dispose();
    shadow.geometry.dispose();
    (shadow.material).dispose();
  }
}
