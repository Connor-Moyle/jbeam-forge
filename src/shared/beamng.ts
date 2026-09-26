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

export interface BeamngDetection {
  /** Validated candidates, most trustworthy first. */
  installs: InstallValidation[];
  /** %LOCALAPPDATA%/BeamNG/BeamNG.drive/current when present. */
  userDir: string | null;
}

export function describeInstallValidation(v: InstallValidation): string {
  const version = v.version ? `BeamNG.drive ${v.version.replace(/\.0$/, '')}` : 'BeamNG.drive (version unknown)';
  return `${version} · ${v.vehicleCount} vehicle${v.vehicleCount === 1 ? '' : 's'}`;
}
