import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type ForgeApi,
  type InvokeChannel,
  type IpcResult,
} from '@shared/ipc-contract';

const invokeAllowed = new Set<string>(INVOKE_CHANNELS);
const eventAllowed = new Set<string>(EVENT_CHANNELS);

const api = {
  invoke(channel: InvokeChannel, req?: unknown) {
    if (!invokeAllowed.has(channel)) {
      return Promise.resolve<IpcResult<never>>({
        ok: false,
        error: { message: `IPC channel not allowed: ${String(channel)}`, code: 'EACCES' },
      });
    }
    return ipcRenderer.invoke(channel, req) as Promise<IpcResult<never>>;
  },
  on(channel: EventChannel, listener: (payload: never) => void) {
    if (!eventAllowed.has(channel)) {
      throw new Error(`IPC event not allowed: ${String(channel)}`);
    }
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  harness: process.argv.includes('--jbforge-harness'),
  isDev: process.argv.includes('--jbforge-dev'),
} as ForgeApi;

contextBridge.exposeInMainWorld('forge', api);
