import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

const external = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)];

// The library: the engine and the page component, for use inside a React app.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/lib',
    cssCodeSplit: false,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index', cssFileName: 'style' },
    rollupOptions: {
      // A dependency's stylesheet is not left as an import: it goes into style.css with the
      // rest, so the built library is plain JavaScript that Node can load too.
      external: (id) =>
        !id.endsWith('.css') && external.some((name) => id === name || id.startsWith(`${name}/`)),
    },
  },
});
