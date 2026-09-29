import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Where downloaded textures and meshes live: with the program.
 *  - Portable exe: a "JBeam Forge Content" folder next to the exe.
 *  - Installed: a "JBeam Forge Content" folder beside the install folder
 *    (…\Programs\JBeam Forge Content). Not inside it: the uninstaller, which
 *    every update runs, empties the install folder.
 *  - Development: content/ in the repository.
 * A folder chosen in Settings wins. If the place isn't writable (a
 * machine-wide install under Program Files), it falls back to the user's
 * app-data folder.
 */

export const CONTENT_FOLDER_NAME = 'JBeam Forge Content';

export interface ContentPathInput {
  override: string | null;
  isPackaged: boolean;
  /** electron-builder's portable launcher sets PORTABLE_EXECUTABLE_DIR. */
  portableDir: string | undefined;
  execPath: string;
  appPath: string;
  userData: string;
}

/** The preferred folder, before checking it can be written. */
export function preferredContentRoot(i: ContentPathInput): string {
  if (i.override) return i.override;
  if (!i.isPackaged) return join(i.appPath, 'content');
  if (i.portableDir) return join(i.portableDir, CONTENT_FOLDER_NAME);
  return join(dirname(dirname(i.execPath)), CONTENT_FOLDER_NAME);
}

async function writable(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** The folder to use, and whether it had to fall back. */
export async function resolveContentRoot(i: ContentPathInput): Promise<{ root: string; fallback: boolean; preferred: string }> {
  const preferred = preferredContentRoot(i);
  if (await writable(preferred)) return { root: preferred, fallback: false, preferred };
  return { root: join(i.userData, 'content'), fallback: true, preferred };
}
