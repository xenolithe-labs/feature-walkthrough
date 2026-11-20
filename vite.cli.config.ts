import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// The command line: one Node module with everything it needs inside it.
export default defineConfig({
  plugins: [react()],
  define: { __VERSION__: JSON.stringify(pkg.version) },
  ssr: { noExternal: true },
  build: {
    ssr: 'cli/index.ts',
    outDir: 'dist/cli',
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'index.js' } },
  },
});
