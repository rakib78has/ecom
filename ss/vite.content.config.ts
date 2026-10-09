import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds the injected selection overlay as a single classic script.
 *
 * `emptyOutDir` is off because this runs after the main build and must not
 * delete its output.
 */
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    target: 'chrome116',
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/selection-overlay.ts'),
      name: 'SnapCaptureSelection',
      formats: ['iife'],
      fileName: () => 'selection-overlay.js',
    },
  },
});
