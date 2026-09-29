import { useEffect, useId, useRef, useState } from 'react';
import { FileText, FolderOpen, RotateCcw, ScanSearch } from 'lucide-react';
import { REPO_PATTERN } from '@shared/content/manifest';
import { DEFAULT_SETTINGS, PREVIEW_SIZES, WINDOW_SIZES, type WindowSize } from '@shared/settings-schema';
import { PREVIEW_ANGLES, PREVIEW_BACKDROPS } from '@renderer/panels/viewport/studio';
import type { InstallValidation } from '@shared/beamng';
import { describeInstallValidation } from '@shared/beamng';
import type { Settings, SettingsPatch } from '@shared/settings-schema';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { CollapsibleSection } from '@renderer/ui/components/CollapsibleSection';
import { Field, FieldGroup } from '@renderer/ui/components/Field';
import { Input } from '@renderer/ui/components/Input';
import { Modal } from '@renderer/ui/components/Modal';
import { NumberInput } from '@renderer/ui/components/NumberInput';
import { Select } from '@renderer/ui/components/Select';
import { Slider } from '@renderer/ui/components/Slider';
import { Toggle } from '@renderer/ui/components/Toggle';
import { call, IpcCallError } from '@renderer/diagnostics/ipc';
import { useUiStore } from '@renderer/app/stores/ui';
import { BeamngParts, LibraryFolderList, ScanNow, useLibraryStatus } from './LibraryFolders';
import styles from './SettingsModal.module.css';

const VALIDATE_DEBOUNCE_MS = 250;

/** Validation state; `forDir` ties every answer to the exact path it was for. */
type Check =
  | { state: 'idle' }
  | { state: 'checking'; forDir: string }
  | { state: 'done'; forDir: string; result: InstallValidation }
  | { state: 'error'; forDir: string; message: string };

const SECTIONS = [
  { id: 'beamng', label: 'BeamNG.drive' },
  { id: 'general', label: 'General' },
  { id: 'display', label: 'Window & display' },
  { id: 'graphics', label: 'Viewport & graphics' },
  { id: 'units', label: 'Units' },
  { id: 'export', label: 'Export' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'library', label: 'Library folders' },
  { id: 'naming', label: 'Naming' },
  { id: 'diagnostics', label: 'Diagnostics' },
] as const;

const WINDOW_LABELS: Record<WindowSize, string> = {
  remember: 'Remember the last size',
  '1280x720': '1280 × 720 (HD)',
  '1366x768': '1366 × 768',
  '1600x900': '1600 × 900 (HD+)',
  '1920x1080': '1920 × 1080 (Full HD)',
  '2560x1440': '2560 × 1440 (QHD)',
  '3840x2160': '3840 × 2160 (4K UHD)',
  custom: 'Custom…',
};
const AUTOSAVE = [0, 1, 2, 5, 10, 15, 30] as const;
const RENDER_SCALES = [0.5, 0.67, 0.75, 1, 1.25, 1.5, 2] as const;
const FPS = [0, 30, 60, 120, 144, 240] as const;

export interface SettingsModalProps {
  settings: Settings;
  onClose: () => void;
}

/**
 * App settings (SPEC §3.1: the BeamNG install is a persisted app setting).
 * Mounted only while open, so drafts initialise from current settings.
 */
export function SettingsModal({ settings, onClose }: SettingsModalProps) {
  const dirId = useId();
  const [dir, setDir] = useState(settings.beamngInstallDir ?? '');
  // Everything but the install folder is edited as one draft and saved as the fields that changed.
  const [d, setD] = useState<Settings>(settings);
  // What the window opened with: Save sends only what was changed here, so a setting changed
  // elsewhere meanwhile (the Debug Logging menu item, a library scan…) isn't put back.
  const [initial] = useState<Settings>(settings);
  const set = (patch: Partial<Settings>) => setD((cur) => ({ ...cur, ...patch }));
  const [section, setSection] = useState<string>(SECTIONS[0].id);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [libraryStatus, rescan] = useLibraryStatus();
  const [check, setCheck] = useState<Check>(() => {
    const initial = (settings.beamngInstallDir ?? '').trim();
    return initial ? { state: 'checking', forDir: initial } : { state: 'idle' };
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const requestId = useRef(0);
  const pushStatus = useUiStore((s) => s.pushStatus);

  // Validate the path as it changes (debounced; stale answers are dropped).
  useEffect(() => {
    const trimmed = dir.trim();
    const id = ++requestId.current;
    if (!trimmed) return;
    const timer = setTimeout(() => {
      call('beamng:validate', { dir: trimmed })
        .then((result) => {
          if (id === requestId.current) setCheck({ state: 'done', forDir: trimmed, result });
        })
        .catch((err: unknown) => {
          if (id === requestId.current) setCheck({ state: 'error', forDir: trimmed, message: err instanceof Error ? err.message : String(err) });
        });
    }, VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dir]);

  const changeDir = (next: string) => {
    setNotice(null);
    setSaveError(null);
    // Any edit invalidates the previous answer immediately (not after the debounce).
    const trimmed = next.trim();
    setCheck(trimmed ? { state: 'checking', forDir: trimmed } : { state: 'idle' });
    setDir(next);
  };

  const browse = () => {
    call('dialog:pickDirectory', { title: 'Select the BeamNG.drive install folder', ...(dir.trim() ? { defaultPath: dir.trim() } : {}) })
      .then((picked) => {
        if (picked) changeDir(picked);
      })
      .catch(() => undefined);
  };

  const autoDetect = () => {
    call('beamng:detect')
      .then(({ installs }) => {
        const found = installs.find((i) => i.ok);
        if (found) {
          changeDir(found.dir);
          setNotice(installs.filter((i) => i.ok).length > 1 ? 'Several installs found; picked the one BeamNG last ran from.' : null);
        } else {
          setNotice('No BeamNG.drive install was found automatically. Use Browse to pick the folder that contains BeamNG.drive.exe.');
        }
      })
      .catch(() => undefined);
  };

  const trimmedDir = dir.trim();
  const dirChanged = trimmedDir !== (settings.beamngInstallDir ?? '');
  const dirValid = !trimmedDir || (check.state === 'done' && check.forDir === trimmedDir && check.result.ok);
  const canSave = !saving && (!dirChanged || dirValid);

  const badRepos = (['appRepo', 'texturesRepo', 'meshesRepo', 'scriptsRepo'] as const).filter((k) => !REPO_PATTERN.test(d[k]));
  const badBranch = !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(d.contentBranch) || d.contentBranch.includes('..');
  const canSaveAll = canSave && !badRepos.length && !badBranch;

  const save = () => {
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(d) as (keyof Settings)[]) {
      if (key === 'version' || key === 'beamngInstallDir' || key === 'beamngUserDir') continue;
      if (JSON.stringify(d[key]) !== JSON.stringify(initial[key])) patch[key] = d[key];
    }
    if (dirChanged) patch.beamngInstallDir = trimmedDir || null;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    call('settings:update', patch as SettingsPatch)
      .then(() => {
        pushStatus('Settings saved', 'success');
        onClose();
      })
      .catch((err: unknown) => {
        setSaving(false);
        setSaveError(err instanceof IpcCallError ? err.ipcError.message : String(err));
      });
  };

  /** Back to defaults, keeping what identifies you and your folders (the game, library folders, author). */
  const resetAll = () => {
    setD({ ...DEFAULT_SETTINGS, beamngInstallDir: settings.beamngInstallDir, beamngUserDir: settings.beamngUserDir, author: d.author, materialFolders: d.materialFolders, objectFolders: d.objectFolders });
    setNotice(null);
  };

  const jump = (id: string) => {
    setSection(id);
    bodyRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  // The section list follows scrolling.
  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const top = body.getBoundingClientRect().top;
    let current: string = SECTIONS[0].id;
    for (const el of body.querySelectorAll<HTMLElement>('[data-section]')) if (el.getBoundingClientRect().top - top < 80) current = el.dataset.section!;
    setSection(current);
  };

  const pickContentDir = () => {
    call('dialog:pickDirectory', { title: 'Choose where downloaded textures and meshes go', ...(d.contentDir ? { defaultPath: d.contentDir } : {}) })
      .then((picked) => {
        if (picked) set({ contentDir: picked });
      })
      .catch(() => undefined);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Settings"
      size="lg"
      footer={
        <>
          <Button variant="ghost" icon={RotateCcw} onClick={resetAll} data-testid="settings-reset">
            Reset to defaults
          </Button>
          <span className={styles.spacer} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!canSaveAll} data-testid="settings-save">
            Save
          </Button>
        </>
      }
    >
      <div className={styles.layout} data-testid="settings-modal">
        <nav className={styles.nav} aria-label="Settings sections">
          {SECTIONS.map((sec) => (
            <button key={sec.id} type="button" className={section === sec.id ? `${styles.navItem} ${styles.navOn}` : styles.navItem} onClick={() => jump(sec.id)} aria-current={section === sec.id ? 'true' : undefined}>
              {sec.label}
            </button>
          ))}
        </nav>
        <div className={styles.sections} ref={bodyRef} onScroll={onScroll}>
          <section data-section="beamng">
            <FieldGroup title="BeamNG.drive">
              <Field
                label="Install folder"
                htmlFor={dirId}
                hint="The game folder containing BeamNG.drive.exe. Official vehicles are read from here (never modified) to verify every exported format."
              >
                <Input id={dirId} mono value={dir} onChange={(e) => changeDir(e.target.value)} placeholder="e.g. C:\Program Files (x86)\Steam\steamapps\common\BeamNG.drive" data-testid="beamng-dir" />
                <Button icon={FolderOpen} onClick={browse}>
                  Browse
                </Button>
                <Button icon={ScanSearch} onClick={autoDetect}>
                  Detect
                </Button>
              </Field>
              <InstallStatus dir={trimmedDir} check={check} />
              {notice && (
                <Callout tone="info" className={styles.gap}>
                  {notice}
                </Callout>
              )}
              <Field label="User folder" hint="Where BeamNG keeps mods and logs. Detected automatically.">
                <span className={styles.readonly} data-testid="beamng-user-dir">
                  {settings.beamngUserDir ?? 'Not found'}
                </span>
              </Field>
            </FieldGroup>
          </section>

          <section data-section="general">
            <FieldGroup title="General">
              <Field label="Author" hint="Written into every mod you export (also asked in the New Mod wizard).">
                <Input value={d.author ?? ''} onChange={(e) => set({ author: e.target.value.slice(0, 100) || null })} placeholder="Your name" aria-label="Author" />
              </Field>
              <Toggle checked={d.openLastProject} onChange={(openLastProject) => set({ openLastProject })} label="Open the last project when JBeam Forge starts" />
              <Field label="Autosave" hint="Saves the open project in the background (only projects that have been saved once).">
                <Select value={String(d.autosaveMinutes)} onChange={(v) => set({ autosaveMinutes: Number(v) })} options={AUTOSAVE.map((m) => ({ value: String(m), label: m ? `Every ${m} minute${m === 1 ? '' : 's'}` : 'Off' }))} aria-label="Autosave" />
              </Field>
              <Field label="Recent projects shown">
                <NumberInput value={d.recentLimit} onChange={(recentLimit) => set({ recentLimit })} min={3} max={30} step={1} precision={0} aria-label="Recent projects shown" />
              </Field>
              <Field label="Undo steps kept" hint="More steps use more memory on big projects.">
                <NumberInput value={d.undoLimit} onChange={(undoLimit) => set({ undoLimit })} min={50} max={5000} step={50} precision={0} aria-label="Undo steps kept" />
              </Field>
            </FieldGroup>
          </section>

          <section data-section="display">
            <FieldGroup title="Window & display">
              <Field label="Window size" hint="Applies now and at every start. Larger than the screen fits the screen.">
                <Select<WindowSize> value={d.windowSize} onChange={(windowSize) => set({ windowSize })} options={WINDOW_SIZES.map((w) => ({ value: w, label: WINDOW_LABELS[w] }))} aria-label="Window size" />
              </Field>
              {d.windowSize === 'custom' && (
                <Field label="Custom size">
                  <div className={styles.pair}>
                    <NumberInput value={d.windowWidth} onChange={(windowWidth) => set({ windowWidth })} min={960} max={7680} step={10} precision={0} unit="W" aria-label="Window width" />
                    <NumberInput value={d.windowHeight} onChange={(windowHeight) => set({ windowHeight })} min={600} max={4320} step={10} precision={0} unit="H" aria-label="Window height" />
                  </div>
                </Field>
              )}
              <Field label="Start as">
                <Select value={d.startMode} onChange={(startMode) => set({ startMode })} options={[{ value: 'normal', label: 'A window' }, { value: 'maximized', label: 'Maximised' }, { value: 'fullscreen', label: 'Full screen (F11 to leave)' }]} aria-label="Start as" />
              </Field>
              <Field label="Interface size" hint="Zooms text, panels and toolbar.">
                <Slider value={d.uiScale} onChange={(uiScale) => set({ uiScale })} min={0.75} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} aria-label="Interface size" />
              </Field>
            </FieldGroup>
          </section>

          <section data-section="graphics">
            <FieldGroup title="Viewport & graphics">
              <Field label="Render resolution" hint="The 3D view's resolution as a share of the screen's. Lower is faster on weak GPUs; higher is sharper.">
                <Select value={String(d.renderScale)} onChange={(v) => set({ renderScale: Number(v) })} options={RENDER_SCALES.map((r) => ({ value: String(r), label: `${Math.round(r * 100)}%${r === 1 ? ' (native)' : ''}` }))} aria-label="Render resolution" />
              </Field>
              <Field label="Frame-rate limit">
                <Select value={String(d.maxFps)} onChange={(v) => set({ maxFps: Number(v) })} options={FPS.map((f) => ({ value: String(f), label: f ? `${f} fps` : 'Display rate (no limit)' }))} aria-label="Frame-rate limit" />
              </Field>
              <Toggle checked={d.antialias} onChange={(antialias) => set({ antialias })} label="Anti-aliasing (smooth edges; the view restarts)" />
              <Toggle checked={d.reflections} onChange={(reflections) => set({ reflections })} label="Studio reflections on shiny materials" />
              <Toggle checked={d.showGrid} onChange={(showGrid) => set({ showGrid })} label="Ground grid" />
              <Toggle checked={d.showFps} onChange={(showFps) => set({ showFps })} label="Show frame rate" />
              <Field label="Background">
                <Select value={d.viewportBackground} onChange={(viewportBackground) => set({ viewportBackground })} options={[{ value: 'theme', label: 'Dark (theme)' }, { value: 'black', label: 'Black' }, { value: 'grey', label: 'Grey' }, { value: 'light', label: 'Light' }]} aria-label="Viewport background" />
              </Field>
              <Field label="Camera field of view">
                <Slider value={d.cameraFov} onChange={(cameraFov) => set({ cameraFov: Math.round(cameraFov) })} min={25} max={90} step={1} format={(v) => `${Math.round(v)}°`} aria-label="Camera field of view" />
              </Field>
              <Field label="Orbit speed">
                <Slider value={d.orbitSpeed} onChange={(orbitSpeed) => set({ orbitSpeed })} min={0.2} max={3} step={0.1} format={(v) => `× ${v.toFixed(1)}`} aria-label="Orbit speed" />
              </Field>
              <Field label="Zoom speed">
                <Slider value={d.zoomSpeed} onChange={(zoomSpeed) => set({ zoomSpeed })} min={0.2} max={3} step={0.1} format={(v) => `× ${v.toFixed(1)}`} aria-label="Zoom speed" />
              </Field>
              <Toggle checked={d.invertZoom} onChange={(invertZoom) => set({ invertZoom })} label="Invert scroll-wheel zoom" />
              <Field label="Focus mode: other parts" hint="How much of the rest of the car stays visible while you work on one part. 0% hides it.">
                <Slider value={d.focusGhostOpacity} onChange={(focusGhostOpacity) => set({ focusGhostOpacity })} min={0} max={0.6} step={0.02} format={(v) => `${Math.round(v * 100)}%`} aria-label="Focus mode ghost opacity" />
              </Field>
            </FieldGroup>
          </section>

          <section data-section="units">
            <FieldGroup title="Units">
              <Field label="Speed">
                <Select value={d.speedUnit} onChange={(speedUnit) => set({ speedUnit })} options={[{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }]} aria-label="Speed unit" />
              </Field>
              <Field label="Power">
                <Select value={d.powerUnit} onChange={(powerUnit) => set({ powerUnit })} options={[{ value: 'hp', label: 'hp (mechanical)' }, { value: 'kw', label: 'kW' }, { value: 'ps', label: 'PS (metric hp)' }]} aria-label="Power unit" />
              </Field>
              <Field label="Torque">
                <Select value={d.torqueUnit} onChange={(torqueUnit) => set({ torqueUnit })} options={[{ value: 'nm', label: 'Nm' }, { value: 'lbft', label: 'lb·ft' }]} aria-label="Torque unit" />
              </Field>
              <p className={styles.help}>Used by the engine and gearbox builders and the engine list. The game&rsquo;s own files always stay metric.</p>
            </FieldGroup>
          </section>

          <section data-section="export">
            <FieldGroup title="Export">
              <Toggle checked={d.openFolderAfterExport} onChange={(openFolderAfterExport) => set({ openFolderAfterExport })} label="Open the folder after exporting" />
              <Toggle checked={d.compressZip} onChange={(compressZip) => set({ compressZip })} label="Compress exported zips" />
              <p className={styles.help}>Compressed zips are smaller to share; uncompressed ones are written faster.</p>
            </FieldGroup>
            <FieldGroup title="Vehicle selector pictures">
              <Field label="Size">
                <Select value={d.previewSize} onChange={(previewSize) => set({ previewSize })} options={PREVIEW_SIZES.map((v) => ({ value: v, label: `${v.replace('x', ' × ')}${v === '500x281' ? ' (small)' : v === '1280x720' ? ' (HD)' : v === '1920x1080' ? ' (full HD)' : ' (QHD)'}` }))} aria-label="Picture size" data-testid="preview-size" />
              </Field>
              <Field label="Angle">
                <Select value={d.previewAngle} onChange={(previewAngle) => set({ previewAngle })} options={PREVIEW_ANGLES.map((a) => ({ value: a.value, label: a.label }))} aria-label="Picture angle" />
              </Field>
              <Field label="Backdrop">
                <Select value={d.previewBackdrop} onChange={(previewBackdrop) => set({ previewBackdrop })} options={Object.entries(PREVIEW_BACKDROPS).map(([value, b]) => ({ value: value as Settings['previewBackdrop'], label: b.label }))} aria-label="Picture backdrop" />
              </Field>
              <p className={styles.help}>Every export draws the car in a studio, like the game&rsquo;s own vehicle pictures: default.jpg for the model, and one per configuration with its parts and paint.</p>
            </FieldGroup>
          </section>

          <section data-section="downloads">
            <FieldGroup title="Downloads">
              <Field label="Content folder" hint="Where downloaded textures and meshes are kept. By default a JBeam Forge Content folder beside the program, kept when you update.">
                <span className={styles.readonly} title={d.contentDir ?? undefined} data-testid="content-dir">
                  {d.contentDir ?? 'Beside the program (default)'}
                </span>
                <Button icon={FolderOpen} onClick={pickContentDir}>
                  Choose
                </Button>
                {d.contentDir && <Button onClick={() => set({ contentDir: null })}>Default</Button>}
              </Field>
              <Toggle checked={d.checkUpdatesOnStartup} onChange={(checkUpdatesOnStartup) => set({ checkUpdatesOnStartup })} label="Check for a new version and new content at startup" />
              <Toggle checked={d.includePrereleases} onChange={(includePrereleases) => set({ includePrereleases })} label="Include pre-release (test) versions" />
              <Field label="Files downloaded at once">
                <NumberInput value={d.downloadConcurrency} onChange={(downloadConcurrency) => set({ downloadConcurrency })} min={1} max={8} step={1} precision={0} aria-label="Files downloaded at once" />
              </Field>
              <CollapsibleSection id="settings-repos" title="Repositories (advanced)" defaultOpen={false}>
                <Field label="App releases" hint="GitHub owner/name that publishes JBeam Forge versions.">
                  <Input mono value={d.appRepo} onChange={(e) => set({ appRepo: e.target.value.trim() })} invalid={!REPO_PATTERN.test(d.appRepo)} aria-label="App repository" />
                </Field>
                <Field label="Textures">
                  <Input mono value={d.texturesRepo} onChange={(e) => set({ texturesRepo: e.target.value.trim() })} invalid={!REPO_PATTERN.test(d.texturesRepo)} aria-label="Textures repository" />
                </Field>
                <Field label="Meshes">
                  <Input mono value={d.meshesRepo} onChange={(e) => set({ meshesRepo: e.target.value.trim() })} invalid={!REPO_PATTERN.test(d.meshesRepo)} aria-label="Meshes repository" />
                </Field>
                <Field label="Scripts">
                  <Input mono value={d.scriptsRepo} onChange={(e) => set({ scriptsRepo: e.target.value.trim() })} invalid={!REPO_PATTERN.test(d.scriptsRepo)} aria-label="Scripts repository" />
                </Field>
                <Field label="Latest content branch">
                  <Input mono value={d.contentBranch} onChange={(e) => set({ contentBranch: e.target.value.trim() })} invalid={badBranch} aria-label="Content branch" />
                </Field>
                {(badRepos.length > 0 || badBranch) && (
                  <Callout tone="danger" className={styles.gap}>
                    Repositories are written owner/name (e.g. Connor-Moyle/jbeam-forge); the branch is a plain name like main.
                  </Callout>
                )}
              </CollapsibleSection>
            </FieldGroup>
          </section>

          <section data-section="library">
            <FieldGroup title="Library folders">
              <p className={styles.help}>
                Folders of your own materials and meshes. They&rsquo;re scanned when JBeam Forge starts (and when you save changes here), named consistently, and added to the Material library and the Objects panel. Only folders that changed are scanned again.
              </p>
              <Field label="Materials">
                <LibraryFolderList kind="materials" folders={d.materialFolders} onChange={(materialFolders) => set({ materialFolders })} status={libraryStatus} />
              </Field>
              <Field label="Objects">
                <LibraryFolderList kind="objects" folders={d.objectFolders} onChange={(objectFolders) => set({ objectFolders })} status={libraryStatus} />
              </Field>
              <BeamngParts status={libraryStatus} />
              <ScanNow status={libraryStatus} onScan={rescan} />
            </FieldGroup>
          </section>

          <section data-section="naming">
            <FieldGroup title="Naming">
              <Toggle checked={d.autoRenameMeshes} onChange={(autoRenameMeshes) => set({ autoRenameMeshes })} label="Auto-rename meshes" />
              <p className={styles.help}>Name each mesh after the part it&rsquo;s assigned to (rear_left_halfshaft, rear_left_halfshaft_2…). Names you type yourself are never changed.</p>
              <Toggle checked={d.autoRenameDisplayNames} onChange={(autoRenameDisplayNames) => set({ autoRenameDisplayNames })} label="Auto-rename display names" />
              <p className={styles.help}>Drop numbered leftovers from in-game part names, so &ldquo;Hood (2)&rdquo; becomes &ldquo;Hood&rdquo;.</p>
            </FieldGroup>
          </section>

          <section data-section="diagnostics">
            <FieldGroup title="Diagnostics">
              <Toggle checked={d.debugLogging} onChange={(debugLogging) => set({ debugLogging })} label="Debug logging" />
              <p className={styles.help}>Writes more detail to the log file. Useful when reporting a problem.</p>
              <div className={styles.buttons}>
                <Button icon={FolderOpen} onClick={() => void call('shell:openLogFolder')}>
                  Open log folder
                </Button>
                <Button icon={FileText} onClick={() => void call('app:revealSettings')}>
                  Show settings file
                </Button>
              </div>
            </FieldGroup>
          </section>

          {saveError && (
            <Callout tone="danger" title="Could not save settings">
              {saveError}
            </Callout>
          )}
        </div>
      </div>
    </Modal>
  );
}

function InstallStatus({ dir, check }: { dir: string; check: Check }) {
  if (!dir) {
    return (
      <Callout tone="warning" className={styles.gap}>
        No install folder set. Ground-truth checks and exports need BeamNG.drive installed.
      </Callout>
    );
  }
  if (check.state === 'idle' || check.state === 'checking' || check.forDir !== dir) {
    return <p className={styles.help}>Checking folder…</p>;
  }
  if (check.state === 'error') {
    return (
      <Callout tone="danger" className={styles.gap}>
        {check.message}
      </Callout>
    );
  }
  const r = check.result;
  if (r.ok) {
    return (
      <Callout tone="success" className={styles.gap} more={r.build ?? undefined}>
        <span data-testid="beamng-status">{describeInstallValidation(r)}</span>
      </Callout>
    );
  }
  return (
    <Callout tone="danger" title="Not a BeamNG.drive install" className={styles.gap}>
      <span data-testid="beamng-status">{r.problems.join(' ')}</span>
    </Callout>
  );
}
