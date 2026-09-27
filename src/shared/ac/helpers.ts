/**
 * Meshes an Assetto Corsa car carries for the game's own effects, which would
 * otherwise sit on top of the real ones: blurred rims (shown at speed),
 * broken-glass damage, the cockpit windscreen reflection, the unbuckled
 * seatbelt, and the low-detail cockpit (when the detailed one is there).
 * They come in ignored: still in the Scene tree, not drawn or exported.
 */
export function isAcHelperMesh(name: string, shader: string | undefined, hasDetailedCockpit: boolean): boolean {
  if (/blur/i.test(name)) return true;
  if (shader === 'ksBrokenGlass' || shader === 'ksWindscreen') return true;
  if (/^cinture_off/i.test(name)) return true;
  if (hasDetailedCockpit && /cockpit_lr/i.test(name)) return true;
  return false;
}
