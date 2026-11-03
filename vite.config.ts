import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdf-engine';
          if (id.includes('page-flip')) return 'page-flip-engine';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
  worker: { format: 'es' },
});
