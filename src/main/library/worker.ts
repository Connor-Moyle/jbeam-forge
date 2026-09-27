import { parentPort } from 'node:worker_threads';
import { scanMaterials, writeMaterialPack } from './materialScan';
import { scanObjects, writeObjectPack } from './objectScan';

/** Scans one library folder off the main thread (EXR conversion and texture splitting are CPU-heavy). */
export interface ScanJob {
  kind: 'materials' | 'objects';
  folder: string;
  out: string;
  title: string;
}
export type ScanResult = { ok: true; count: number } | { ok: false; error: string };

parentPort?.on('message', (job: ScanJob) => {
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
