import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The build tools live in the home folder and the app libraries in the repo.
// npm also installs a copy of preact next to the tools (a peer of the Preact
// plugin and the test helpers), so pin every import to the repo's copy.
export default defineConfig({
  base: '/track-log-plotter/',
  plugins: [preact()],
  resolve: { dedupe: ['preact', '@preact/signals', '@preact/signals-core'] },
  // local-tracks/ holds your own logs for trying the app; never serve them.
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/local-tracks/**'] } },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
