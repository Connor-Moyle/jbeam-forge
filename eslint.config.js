import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import noFreshSelectorFallback from './eslint-rules/no-fresh-selector-fallback.js';

const forge = { rules: { 'no-fresh-selector-fallback': noFreshSelectorFallback } };

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'artifacts/**', 'coverage/**', 'node_modules/**'] },

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
    },
  },

  // Renderer + workers: React, hooks rules as errors (SPEC §3.5), selector discipline.
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/workers/**/*.ts', 'tests/renderer/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    plugins: { react, 'react-hooks': reactHooks, forge },
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react/prop-types': 'off',
      'forge/no-fresh-selector-fallback': 'error',
    },
  },

  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'tests/main/**/*.ts', 'tests/shared/**/*.ts', 'tests/scripts/**/*.ts', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    files: ['scripts/**/*.mjs', 'eslint-rules/**/*.js', 'eslint.config.js'],
    // run-desktop evaluates browser code inside page.evaluate callbacks.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // Tests may use loose typing for fakes.
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
