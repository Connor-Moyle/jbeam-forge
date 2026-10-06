/** BeamNG install facts shared between main (detection) and renderer (Settings UI). */
export interface InstallValidation {
  ok: boolean;
  /** Resolved absolute path that was checked. */
  dir: string;
  /** e.g. "0.39.1.0" — from BeamNG.drive.ini, only when its installPath matches `dir`. */
  version: string | null;
  /** integrity.json buildinfo, e.g. "buildbot build 20972 on winbuildbot - 07/08/2026 - 18:16:47". */
  build: string | null;
  vehicleCount: number;
  problems: string[];
}

/** JBeam Forge inside the game: the version this app carries and the one in the mods folder. */
export interface IngameStatus {
  bundled: string | null;
  installed: string | null;
  modsDir: string | null;
  /** An unpacked copy (mods/unpacked/jbeam_forge) is what's installed. */
  unpacked: boolean;
  updateAvailable: boolean;
}

export interface BeamngDetection {
  /** Validated candidates, most trustworthy first. */
  installs: InstallValidation[];
  /** The game's user folder (mods, logs): its ini's userFolder/current, else the default (see locate.ts). */
  userDir: string | null;
}

export function describeInstallValidation(v: InstallValidation): string {
  const version = v.version ? `BeamNG.drive ${v.version.replace(/\.0$/, '')}` : 'BeamNG.drive (version unknown)';
  return `${version} · ${v.vehicleCount} vehicle${v.vehicleCount === 1 ? '' : 's'}`;
}
