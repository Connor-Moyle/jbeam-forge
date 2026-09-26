import type { ForgeApi } from '@shared/ipc-contract';

declare global {
  /** package.json version, injected at build time. */
  const __APP_VERSION__: string;

  interface Window {
    readonly forge: ForgeApi;
  }
}

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

export {};
