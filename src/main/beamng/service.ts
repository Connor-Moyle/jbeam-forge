import type { BeamngDetection, InstallValidation } from '@shared/beamng';
import { describeInstallValidation } from '@shared/beamng';
import type { Logger } from '@shared/logger';
import type { SettingsService } from '../services/settings';
import { defaultRoots, detectInstallDirs, detectUserDir, validateInstallDir, type LocateRoots } from './locate';

/**
 * Roots for detection. The run-desktop harness isolates them via env so it
 * never depends on (or finds) the machine's real BeamNG install.
 */
export function rootsFromEnv(env: NodeJS.ProcessEnv = process.env): LocateRoots {
  if (env.JBFORGE_LOCALAPPDATA !== undefined || env.JBFORGE_STEAM_ROOTS !== undefined) {
    return {
      localAppData: env.JBFORGE_LOCALAPPDATA || undefined,
      steamRoots: (env.JBFORGE_STEAM_ROOTS ?? '').split(';').filter(Boolean),
    };
  }
  return defaultRoots(env);
}

export class BeamngService {
  constructor(
    private readonly roots: LocateRoots,
    private readonly logger: Logger,
  ) {}

  validate(dir: string): Promise<InstallValidation> {
    return validateInstallDir(dir, this.roots);
  }

  async detect(): Promise<BeamngDetection> {
    const dirs = await detectInstallDirs(this.roots);
    const installs = await Promise.all(dirs.map((d) => this.validate(d)));
    return { installs, userDir: await detectUserDir(this.roots) };
  }

  /**
   * First run: if no install is configured and exactly one valid install is
   * found, save it (and the user folder). Returns a status message or null.
   */
  async autoConfigure(settings: SettingsService): Promise<string | null> {
    const before = settings.get();
    if (before.beamngInstallDir && before.beamngUserDir) return null;
    const { installs, userDir } = await this.detect();
    const valid = installs.filter((i) => i.ok);
    const found = valid.length === 1 ? valid[0]! : null;
    if (!found && !before.beamngInstallDir) {
      this.logger.info(`auto-detect: ${valid.length} valid BeamNG installs; leaving the choice to Settings`);
    }

    // Decide against the settings as they are *now*: the user may have saved
    // a folder in Settings while detection was running — never overwrite it.
    let message: string | null = null;
    await settings.updateWith((current) => {
      const patch: { beamngInstallDir?: string; beamngUserDir?: string } = {};
      if (!current.beamngInstallDir && found) {
        patch.beamngInstallDir = found.dir;
        message = `Found ${describeInstallValidation(found)} at ${found.dir}`;
      }
      if (!current.beamngUserDir && userDir) patch.beamngUserDir = userDir;
      if (Object.keys(patch).length === 0) return null;
      this.logger.info('auto-detected BeamNG locations:', JSON.stringify(patch));
      return patch;
    });
    return message;
  }
}
