import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

/**
 * JBeam Forge inside BeamNG.drive: the same screens as the desktop app, built as one ES module
 * (forge.mjs + forge.css) for the game's UI to load (ingame/mod/ui/ui-vue/mods/jbeamForge).
 * `npm run build:ingame` builds it and assembles the mod.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@ingame': resolve(__dirname, 'src/ingame'),
      '@workers': resolve(__dirname, 'src/workers'),
    },
  },
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version), 'process.env.NODE_ENV': JSON.stringify('production') },
  worker: { format: 'es' },
  build: {
    outDir: resolve(__dirname, 'out', 'ingame'),
    emptyOutDir: true,
    target: 'chrome110',
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/ingame/entry.tsx'),
      formats: ['es'],
      fileName: () => 'forge.mjs',
      cssFileName: 'forge',
    },
    rollupOptions: { output: { inlineDynamicImports: false } },
  },
});
