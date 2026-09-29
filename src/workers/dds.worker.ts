/// <reference lib="webworker" />
/**
 * DDS encoder worker (fork): block-compresses textures for export off the
 * UI thread (a 4K texture with its mipmaps takes a moment).
 */
import { chooseFormat, encodeDds, limitSize, type DdsFormat } from '@shared/textures/dds';
import { createWorkerLogger, installWorkerErrorHandlers } from './logBridge';

const logger = createWorkerLogger('worker:dds');
installWorkerErrorHandlers(logger);

export interface DdsJob {
  id: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  kind: 'color' | 'normal' | 'data';
  normalFormat: 'BC3' | 'BC5';
  mipmaps: boolean;
  maxSize: number;
}

self.addEventListener('message', (e: MessageEvent<DdsJob>) => {
  const job = e.data;
  const started = performance.now();
  try {
    const img = limitSize({ width: job.width, height: job.height, data: job.data }, job.maxSize);
    const format: DdsFormat = chooseFormat(img, job.kind, job.normalFormat);
    const bytes = encodeDds(img, format, job.mipmaps);
    logger.debug(`dds ${img.width}x${img.height} ${format} in ${Math.round(performance.now() - started)} ms`);
    (self as unknown as Worker).postMessage({ id: job.id, bytes, format, width: img.width, height: img.height }, [bytes.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) });
  }
});
