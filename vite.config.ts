import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

// The build output is one self-contained HTML file.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
  },
});
