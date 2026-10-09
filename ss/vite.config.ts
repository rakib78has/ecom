import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds the extension pages and the service worker.
 *
 * The injected selection overlay is built separately (vite.content.config.ts)
 * because `chrome.scripting.executeScript({ files })` evaluates a classic
 * script, not a module, so that bundle must be a self-contained IIFE.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  publicDir: resolve(import.meta.dirname, 'public'),
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome116',
    // Readable output keeps Chrome Web Store review (and our own debugging)
    // straightforward; the bundle is small enough that size is not a concern.
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'src/popup/popup.html'),
        editor: resolve(import.meta.dirname, 'src/editor/editor.html'),
        recorder: resolve(import.meta.dirname, 'src/recorder/recorder.html'),
        'service-worker': resolve(import.meta.dirname, 'src/background/service-worker.ts'),
      },
      output: {
        // The manifest references the worker by a stable path, so it cannot
        // be hashed or nested.
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
