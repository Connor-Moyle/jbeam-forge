import { app } from 'electron';
import { describeError } from '@shared/logger';
import { scoped } from './log';

const logger = scoped('crash');

/** Global failure hooks for the main process (SPEC §3.6). */
export function installMainCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    const { message, stack } = describeError(err);
    logger.error('uncaughtException:', message, stack ?? '');
  });

  process.on('unhandledRejection', (reason) => {
    const { message, stack } = describeError(reason);
    logger.error('unhandledRejection:', message, stack ?? '');
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    logger.error('render-process-gone:', details.reason, `exitCode=${details.exitCode}`, webContents.getURL());
  });

  app.on('child-process-gone', (_event, details) => {
    logger.error('child-process-gone:', details.type, details.reason, `exitCode=${details.exitCode}`, details.name ?? '');
  });
}
