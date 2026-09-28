import { projectStore } from '@renderer/app/stores/project';
import { useConfigUi } from '@renderer/configs/commands';
import { useTextureVersion } from '@renderer/materials/runtime';
import { paintPreviewActive, syncPreviewPaints } from './preview';
import { resetPainter } from './painter';

/**
 * Keeps the viewport's paint slots on the project's paints (the previewed
 * configuration's, else the factory defaults). Materials are rebuilt only
 * when paint preview switches on or off; colour changes are uniforms.
 */
let started = false;

export function startPaintSync(): void {
  if (started) return;
  started = true;
  const sync = () => {
    const before = paintPreviewActive();
    const ui = useConfigUi.getState();
    syncPreviewPaints(projectStore.getState().doc, ui.preview ? ui.selected : null);
    if (paintPreviewActive() !== before) useTextureVersion.getState().bump();
  };
  let last: unknown = null;
  // Another project: its canvases aren't this one's (a project is known by when it was made).
  const projectOf = (s: ReturnType<typeof projectStore.getState>) => (s.doc ? `${s.doc.meta.slug}|${s.doc.meta.createdAt}` : null);
  let project = projectOf(projectStore.getState());
  projectStore.subscribe((s) => {
    const now = projectOf(s);
    if (now !== project) {
      project = now;
      resetPainter();
    }
    const key = s.doc ? [s.doc.paints, s.doc.configs] : null;
    if (key && last && (last as unknown[])[0] === key[0] && (last as unknown[])[1] === key[1]) return;
    last = key;
    sync();
  });
  useConfigUi.subscribe(sync);
  sync();
}
