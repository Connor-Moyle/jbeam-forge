import type { ForgeApi, InvokeChannel, InvokeContract, IpcError } from '@shared/ipc-contract';
import { rlog } from './logger';

const logger = rlog('ipc');

export class IpcCallError extends Error {
  constructor(
    readonly channel: InvokeChannel,
    readonly ipcError: IpcError,
  ) {
    super(`${channel}: ${ipcError.message}`);
    this.name = 'IpcCallError';
  }
}

/**
 * Invoke a main-process handler and unwrap its result. Failures are logged
 * here once and re-thrown as IpcCallError so callers can surface them.
 */
export async function call<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeContract[C]['req'] extends undefined ? [req?: InvokeContract[C]['req']] : [req: InvokeContract[C]['req']]
): Promise<InvokeContract[C]['res']> {
  let result;
  try {
    result = await (window.forge.invoke as (c: C, r?: unknown) => ReturnType<ForgeApi['invoke']>)(channel, args[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${channel} transport failure:`, message);
    throw new IpcCallError(channel, { message, code: 'ETRANSPORT' });
  }
  if (!result.ok) {
    logger.error(`${channel} failed:`, result.error.message);
    throw new IpcCallError(channel, result.error);
  }
  return result.value;
}
