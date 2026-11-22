import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    // Process the Testing Library helper with Vite so its preact import is
    // deduped to the repo's copy instead of the one beside the tools.
    server: { deps: { inline: [/@testing-library\/preact/] } },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/main.tsx', 'src/map/**', 'src/parse/worker.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
}));
