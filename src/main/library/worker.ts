import { rmSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { buildPartObjects, importModSets } from '../beamng/partObjects';
import { scanMaterials, writeMaterialPack } from './materialScan';
import { scanObjects, writeObjectPack } from './objectScan';

/** Scans one library folder off the main thread (EXR conversion and texture splitting are CPU-heavy). */
export interface ScanJob {
  /** beamng: `folder` is the BeamNG.drive install. mod: `folder` is a car mod zip (an Automation export). */
  kind: 'materials' | 'objects' | 'beamng' | 'mod';
  folder: string;
  /** mod: the BeamNG install, for the common parts an export leans on. */
  install?: string | null;
  out: string;
  title: string;
}
export type ScanResult = { ok: true; count: number } | { ok: false; error: string };

parentPort?.on('message', (job: ScanJob) => {
  if (job.kind === 'mod') {
    rmSync(job.out, { recursive: true, force: true });
    importModSets(job.folder, job.install ?? null, job.out)
      .then((vehicles) => parentPort?.postMessage({ ok: true, count: vehicles.length } satisfies ScanResult))
      .catch((err: unknown) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ScanResult));
    return;
  }
  if (job.kind === 'beamng') {
    rmSync(job.out, { recursive: true, force: true });
    buildPartObjects(job.folder, job.out)
      .then((count) => parentPort?.postMessage({ ok: true, count } satisfies ScanResult))
      .catch((err: unknown) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ScanResult));
    return;
  }
  let result: ScanResult;
  try {
    if (job.kind === 'materials') {
      const built = scanMaterials(job.folder);
      writeMaterialPack(built, job.out, job.title);
      result = { ok: true, count: built.length };
    } else {
      const built = scanObjects(job.folder);
      writeObjectPack(built, job.out, job.title);
      result = { ok: true, count: built.length };
    }
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  parentPort?.postMessage(result);
});
