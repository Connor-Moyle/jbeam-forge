import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { z } from 'zod';
import type { EventChannel, EventContract, InvokeChannel, InvokeContract, IpcResult } from '@shared/ipc-contract';
import { describeError } from '@shared/logger';
import { scoped } from '../log';

const logger = scoped('ipc');

type Handler<C extends InvokeChannel> = (
  req: InvokeContract[C]['req'],
  event: IpcMainInvokeEvent,
) => Promise<InvokeContract[C]['res']> | InvokeContract[C]['res'];

let isTrustedUrl: (url: string) => boolean = () => false;

/** Only frames showing our own renderer may call IPC handlers. */
export function setTrustedUrlPredicate(pred: (url: string) => boolean): void {
  isTrustedUrl = pred;
}

/**
 * Register an invoke handler. Every call is logged with its duration; any
 * throw (including request validation) becomes `{ ok: false }` instead of an
 * exception crossing the bridge.
 */
export function registerInvoke<C extends InvokeChannel>(
  channel: C,
  handler: Handler<C>,
  schema?: z.ZodType<InvokeContract[C]['req']>,
): void {
  ipcMain.handle(channel, async (event, rawReq: unknown): Promise<IpcResult<InvokeContract[C]['res']>> => {
    const started = performance.now();
    const senderUrl = event.senderFrame?.url ?? '';
    if (!isTrustedUrl(senderUrl)) {
      logger.error(`${channel} rejected: untrusted sender ${senderUrl}`);
      return { ok: false, error: { message: 'Untrusted IPC sender', code: 'EACCES' } };
    }
    try {
      const req = schema ? schema.parse(rawReq) : (rawReq as InvokeContract[C]['req']);
      const value = await handler(req, event);
      logger.debug(`${channel} ok ${(performance.now() - started).toFixed(1)}ms`);
      return { ok: true, value };
    } catch (err) {
      const { message, stack } = describeError(err);
      logger.error(`${channel} failed after ${(performance.now() - started).toFixed(1)}ms:`, message, stack ?? '');
      const code = (err as { code?: unknown }).code;
      return { ok: false, error: typeof code === 'string' ? { message, code } : { message } };
    }
  });
}

export function sendEvent<E extends EventChannel>(target: WebContents, channel: E, payload: EventContract[E]): void {
  if (target.isDestroyed()) return;
  target.send(channel, payload);
}
