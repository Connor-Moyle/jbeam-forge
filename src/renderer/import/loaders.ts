import { LoadingManager, Mesh, MeshStandardMaterial, PropertyBinding, TextureLoader, type Object3D } from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { SourceFormat } from '@shared/project/schema';
import { resolveToken } from '@renderer/ui/tokens';
import { loadKn5 } from './kn5';

/**
 * Format loaders → "loader space" (three.js conventions; see
 * src/shared/coords.ts). Loaders never fetch textures themselves: every image
 * request is answered with a 1×1 placeholder tagged with the original
 * reference, and the texture pass (textures.ts) resolves and loads the real
 * images afterwards — BeamNG ships BC7 DDS files no three.js loader reads.
 */

/** Reads a file next to the model (MTL, glTF .bin/images); null when missing. */
export type ReadSideFile = (relativeRef: string) => Promise<Uint8Array | null>;

const PLACEHOLDER_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
export const REF_MARKER = '#jbfref=';

/** Original texture reference encoded in a placeholder URL, or null. */
export function refFromPlaceholder(src: string | undefined): string | null {
  if (!src) return null;
  const i = src.indexOf(REF_MARKER);
  return i < 0 ? null : decodeURIComponent(src.slice(i + REF_MARKER.length)).replace(TGA_BYPASS_SUFFIX, '');
}

/**
 * ColladaLoader decodes `.tga` images with its own TGALoader, which would
 * choke on our PNG placeholder and never reach the texture pass. Suffixing
 * TGA image references routes them through the normal placeholder path; the
 * suffix is stripped again when the reference is read back.
 */
const TGA_BYPASS_SUFFIX = '.jbf-img';

export function bypassColladaTga(dae: string): string {
  return dae.replace(/(<image\b[^>]*>\s*<init_from>[^<]*\.tga)(<\/init_from>)/gi, `$1${TGA_BYPASS_SUFFIX}$2`);
}

interface TrackedManager {
  manager: LoadingManager;
  /** Resolves when every started item (placeholders, blob side files) has finished. */
  idle: (timeoutMs: number) => Promise<void>;
}

function trackedManager(): TrackedManager {
  const manager = new LoadingManager();
  let pending = 0;
  let waiters: (() => void)[] = [];
  const settle = () => {
    if (pending === 0) {
      const w = waiters;
      waiters = [];
      w.forEach((f) => f());
    }
  };
  const start = manager.itemStart.bind(manager);
  const end = manager.itemEnd.bind(manager);
  const error = manager.itemError.bind(manager);
  manager.itemStart = (url) => {
    pending++;
    start(url);
  };
  manager.itemEnd = (url) => {
    pending--;
    end(url);
    settle();
  };
  manager.itemError = (url) => {
    error(url);
  };
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    return PLACEHOLDER_PNG + REF_MARKER + encodeURIComponent(url);
  });
  return {
    manager,
    idle: (timeoutMs) =>
      new Promise<void>((resolve) => {
        if (pending === 0) return resolve();
        const t = setTimeout(resolve, timeoutMs); // never block an import on a stuck image
        waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      }),
  };
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ktx2: 'image/ktx2' };

/**
 * A .gltf with its external buffers and images inlined as data URIs, so the
 * loader never fetches anything (works identically in Electron and jsdom).
 * Missing side files are left as-is and surface as loader errors/placeholders.
 */
async function inlineGltfSideFiles(json: string, readSide: ReadSideFile): Promise<string> {
  type Entry = { uri?: string };
  const doc = JSON.parse(json) as { buffers?: Entry[]; images?: Entry[] };
  const inline = async (e: Entry, fallbackType: string) => {
    if (!e.uri || e.uri.startsWith('data:')) return;
    const bytes = await readSide(decodeURIComponent(e.uri));
    if (!bytes) return;
    const ext = e.uri.slice(e.uri.lastIndexOf('.') + 1).toLowerCase();
    e.uri = `data:${MIME[ext] ?? fallbackType};base64,${base64(bytes)}`;
  };
  for (const b of doc.buffers ?? []) await inline(b, 'application/octet-stream');
  for (const img of doc.images ?? []) await inline(img, 'application/octet-stream');
  return JSON.stringify(doc);
}

export interface LoaderResult {
  root: Object3D;
}

/**
 * FBXLoader runs every object name through PropertyBinding.sanitizeNodeName,
 * which deletes dots: Blender's "Door.001" duplicate becomes "Door001" and the
 * copy number glues onto the name. We don't bind animations, so keep the names
 * as the artist typed them (spaces still become underscores). The parse is
 * synchronous, so swapping the function around it is safe.
 */
function parseFbxKeepingNames(bytes: Uint8Array, manager: LoadingManager): Object3D {
  const original = Object.getOwnPropertyDescriptor(PropertyBinding, 'sanitizeNodeName')!;
  Object.defineProperty(PropertyBinding, 'sanitizeNodeName', { ...original, value: (name: string) => name.replace(/\s/g, '_') });
  try {
    return new FBXLoader(manager).parse(toArrayBuffer(bytes), '');
  } finally {
    Object.defineProperty(PropertyBinding, 'sanitizeNodeName', original);
  }
}

export async function loadIntoLoaderSpace(format: SourceFormat, bytes: Uint8Array, fileName: string, readSide: ReadSideFile): Promise<LoaderResult> {
  const { manager, idle } = trackedManager();
  let root: Object3D;

  switch (format) {
    case 'dae': {
      const collada = new ColladaLoader(manager).parse(bypassColladaTga(decodeText(bytes)), '');
      if (!collada?.scene) throw new Error('Not a readable COLLADA (.dae) file');
      root = collada.scene;
      break;
    }
    case 'fbx':
      root = parseFbxKeepingNames(bytes, manager);
      break;
    case 'obj': {
      const text = decodeText(bytes);
      const loader = new OBJLoader(manager);
      const mtlName = text.match(/^\s*mtllib\s+(.+?)\s*$/m)?.[1];
      if (mtlName) {
        const mtl = await readSide(mtlName);
        if (mtl) {
          const creator = new MTLLoader(manager).parse(decodeText(mtl), '');
          creator.preload();
          loader.setMaterials(creator);
        }
      }
      root = loader.parse(text);
      break;
    }
    case 'gltf':
    case 'glb': {
      const data: string | ArrayBuffer = format === 'gltf' ? await inlineGltfSideFiles(decodeText(bytes), readSide) : toArrayBuffer(bytes);
      root = await new Promise<Object3D>((resolve, reject) => {
        const loader = new GLTFLoader(manager);
        // Under Electron GLTFLoader would use ImageBitmapLoader, whose images have no `src`,
        // so the texture pass couldn't read placeholder references. Use image elements instead.
        loader.register((parser) => {
          parser.textureLoader = new TextureLoader(parser.options.manager);
          return { name: 'jbf_image_textures' };
        });
        loader.parse(data, '', (g) => resolve(g.scene), (e) => reject(e instanceof Error ? e : new Error('The glTF file could not be read')));
      });
      break;
    }
    case 'stl': {
      const geometry = new STLLoader(manager).parse(toArrayBuffer(bytes));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: resolveToken('mesh-default') || undefined, roughness: 0.6 }));
      mesh.name = fileName.replace(/\.stl$/i, '');
      root = mesh;
      break;
    }
    case 'kn5':
      root = loadKn5(bytes, manager);
      break;
  }

  await idle(10_000);
  return { root };
}
