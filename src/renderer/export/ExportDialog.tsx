import { useMemo } from 'react';
import { Download, FolderOpen, PackageCheck, RefreshCw, Wand2 } from 'lucide-react';
import { call } from '@renderer/diagnostics/ipc';
import { generateParts, useStructureUi } from '@renderer/structure/generate';
import { Badge } from '@renderer/ui/components/Badge';
import { Button } from '@renderer/ui/components/Button';
import { Callout } from '@renderer/ui/components/Callout';
import { Modal } from '@renderer/ui/components/Modal';
import { ScrollArea } from '@renderer/ui/components/ScrollArea';
import { refreshExport, runExport, useExportUi } from './exportFlow';
import styles from './ExportDialog.module.css';

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

/** Export Mod: validation report, then install unpacked into BeamNG or save a zip (SPEC §4.15). */
export function ExportDialog() {
  const open = useExportUi((s) => s.open);
  const prepared = useExportUi((s) => s.prepared);
  const busy = useExportUi((s) => s.busy);
  const result = useExportUi((s) => s.result);
  const error = useExportUi((s) => s.error);
  const setOpen = useExportUi((s) => s.setOpen);
  const generating = useStructureUi((s) => s.busy);

  const notGenerated = useMemo(() => prepared?.report.errors.filter((e) => (e.code === 'not-generated' || e.code === 'body-not-generated') && e.partId).map((e) => e.partId!) ?? [], [prepared]);
  if (!open) return null;
  const errors = prepared?.report.errors ?? [];
  const warnings = prepared?.report.warnings ?? [];
  const slug = prepared?.bundle.slug ?? '';

  const generateMissing = async () => {
    await generateParts(notGenerated, `Generate ${notGenerated.length} missing parts`);
    refreshExport();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) setOpen(false);
      }}
      title="Export mod"
      description={prepared ? `vehicles/${slug}/ · ${prepared.summary.parts} parts · ${prepared.summary.meshes} meshes · ${prepared.summary.nodes.toLocaleString()} nodes · ${prepared.summary.beams.toLocaleString()} beams · ${prepared.summary.textures} textures · DAE ${mb(prepared.summary.daeBytes)}` : undefined}
      footer={
        result ? (
          <>
            <Button icon={FolderOpen} onClick={() => void call('export:reveal')}>
              Show in folder
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button icon={RefreshCw} variant="ghost" onClick={refreshExport} disabled={!!busy}>
              Re-check
            </Button>
            <Button icon={Download} onClick={() => void runExport('zip')} disabled={!prepared || errors.length > 0 || !!busy} data-testid="export-zip">
              Save .zip…
            </Button>
            <Button icon={PackageCheck} variant="primary" onClick={() => void runExport('install')} disabled={!prepared || errors.length > 0 || !!busy} data-testid="export-install">
              Install to BeamNG
            </Button>
          </>
        )
      }
    >
      <div className={styles.body} data-testid="export-dialog">
        {error && <Callout tone="danger">{error}</Callout>}
        {busy && <Callout tone="info">{busy}</Callout>}
        {result ? (
          <div className={styles.result} data-testid="export-result">
            <Callout tone="success">
              {result.mode === 'install' ? 'Installed as an unpacked mod' : 'Saved'}: <span className={styles.path}>{result.path}</span> ({mb(result.bytes)})
            </Callout>
            <p className={styles.heading}>Test it in BeamNG (docs/testing-in-beamng.md)</p>
            <ol className={styles.steps}>
              <li>Fully quit BeamNG if it is running, then launch it (a fresh beamng.log).</li>
              <li>Load Gridmap, open the vehicle selector and pick “{prepared?.bundle.projectName}”.</li>
              <li>Check: it spawns without an error popup, the body is visible, the parts menu (Ctrl+W) lists the slots, and it sits or rolls without falling apart.</li>
              <li>Send back which checks passed and beamng.log (from %LOCALAPPDATA%\BeamNG\BeamNG.drive\current).</li>
            </ol>
          </div>
        ) : (
          <>
            {errors.length > 0 && (
              <section>
                <p className={styles.heading}>
                  Must fix before export <Badge tone="danger">{errors.length}</Badge>
                  {notGenerated.length > 0 && (
                    <Button size="sm" icon={Wand2} onClick={() => void generateMissing()} disabled={generating} data-testid="export-generate-missing">
                      Generate {notGenerated.length} missing
                    </Button>
                  )}
                </p>
                <ScrollArea className={styles.list}>
                  <ul data-testid="export-errors">
                    {errors.map((e, i) => (
                      <li key={`${e.code}-${i}`}>{e.message}</li>
                    ))}
                  </ul>
                </ScrollArea>
              </section>
            )}
            {errors.length === 0 && prepared && <Callout tone="success">Validation passed: every part has flexbodies bound to node groups, every mesh is in the DAE, refNodes are placed.</Callout>}
            {warnings.length > 0 && (
              <section>
                <p className={styles.heading}>
                  Warnings <Badge tone="warning">{warnings.length}</Badge>
                </p>
                <ScrollArea className={styles.list}>
                  <ul data-testid="export-warnings">
                    {warnings.map((w, i) => (
                      <li key={`${w.code}-${i}`}>{w.message}</li>
                    ))}
                  </ul>
                </ScrollArea>
              </section>
            )}
            <p className={styles.note}>“Install to BeamNG” writes mods/unpacked/{slug} in your BeamNG user folder, replacing only an earlier export from JBeam Forge.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
