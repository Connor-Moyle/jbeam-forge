import type { Logger } from '@shared/logger';
import type { LibraryItem, ObjectItem } from '@shared/ipc-contract';
import { loadBundledObjects, loadBundledPack } from '../services/materialLibrary';

/**
 * The material and object packs the app offers: any pack still bundled with
 * an older install, plus the textures and meshes downloaded into the content
 * folder. Downloads unpack to the same folder layout the packs had, so ids
 * match and a downloaded item simply replaces its bundled twin. Reloaded
 * after every download or removal.
 */
export class Packs {
  private materialsP: Promise<LibraryItem[]>;
  private objectsP: Promise<ObjectItem[]>;

  constructor(
    private readonly dirs: { bundledMaterials: string; bundledObjects: string; textures: () => string; meshes: () => string },
    private readonly logger: Logger,
  ) {
    this.materialsP = this.loadMaterials();
    this.objectsP = this.loadObjects();
  }

  private async loadMaterials(): Promise<LibraryItem[]> {
    const [bundled, downloaded] = await Promise.all([loadBundledPack(this.dirs.bundledMaterials, this.logger), loadBundledPack(this.dirs.textures(), this.logger)]);
    return dedupe(bundled, downloaded);
  }

  private async loadObjects(): Promise<ObjectItem[]> {
    const [bundled, downloaded] = await Promise.all([loadBundledObjects(this.dirs.bundledObjects, this.logger), loadBundledObjects(this.dirs.meshes(), this.logger)]);
    return dedupe(bundled, downloaded);
  }

  materials(): Promise<LibraryItem[]> {
    return this.materialsP;
  }

  objects(): Promise<ObjectItem[]> {
    return this.objectsP;
  }

  reload(kind: 'textures' | 'meshes' | 'scripts' | 'all' = 'all'): void {
    if (kind === 'scripts') return;
    if (kind !== 'meshes') this.materialsP = this.loadMaterials();
    if (kind !== 'textures') this.objectsP = this.loadObjects();
  }
}

/** Downloaded items win over bundled ones with the same id. */
function dedupe<T extends { id: string }>(bundled: T[], downloaded: T[]): T[] {
  const ids = new Set(downloaded.map((d) => d.id));
  return [...bundled.filter((b) => !ids.has(b.id)), ...downloaded];
}
