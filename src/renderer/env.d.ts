import type { ForgeApi } from '@shared/ipc-contract';

declare global {
  interface Window {
    readonly forge: ForgeApi;
  }
}

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

export {};
