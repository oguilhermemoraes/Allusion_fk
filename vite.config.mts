import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^~normalize\.css/, replacement: 'normalize.css' },
      { find: /^~resources\//, replacement: `${path.resolve(__dirname, 'resources')}/` },
      { find: /^~/, replacement: '' },
      { find: 'common', replacement: path.resolve(__dirname, 'common') },
      { find: 'widgets', replacement: path.resolve(__dirname, 'widgets') },
      { find: 'resources', replacement: path.resolve(__dirname, 'resources') },
      { find: 'src', replacement: path.resolve(__dirname, 'src') },
      { find: 'fs-extra', replacement: path.resolve(__dirname, 'src/frontend/services/fs-shim.js') },
      { find: 'fs', replacement: path.resolve(__dirname, 'src/frontend/services/fs-shim.js') },
      { find: 'path', replacement: path.resolve(__dirname, 'src/frontend/services/path-shim.js') },
      { find: 'os', replacement: path.resolve(__dirname, 'src/frontend/services/os-shim.js') },
      { find: 'stream', replacement: path.resolve(__dirname, 'src/frontend/services/stream-shim.js') },
      { find: 'util', replacement: path.resolve(__dirname, 'src/frontend/services/util-shim.js') },
    ],
  },
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['legacy-js-api', 'import'],
      },
    },
  },
  define: {
    global: 'globalThis',
    'process.env': {},
    'process.type': JSON.stringify('renderer'),
    'process.platform': JSON.stringify(process.platform),
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
});
