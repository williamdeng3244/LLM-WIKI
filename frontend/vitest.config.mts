import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// No @vitejs/plugin-react: vitest transforms .tsx via esbuild's automatic JSX
// runtime, which is all testing-library needs (no fast-refresh in tests) and
// avoids the plugin<->vite version coupling. jsdom for component tests; the
// `@/*` alias mirrors tsconfig ("@/*" -> "./*").
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['{lib,components,app}/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'e2e', '.next'],
  },
});
