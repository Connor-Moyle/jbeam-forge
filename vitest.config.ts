import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@workers': resolve(__dirname, 'src/workers'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/main/**/*.test.ts', 'tests/shared/**/*.test.ts', 'tests/scripts/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/renderer/**/*.test.{ts,tsx}', 'tests/workers/**/*.test.ts'],
          setupFiles: ['tests/setup-dom.ts'],
          css: { modules: { classNameStrategy: 'non-scoped' } },
        },
      },
    ],
  },
});
