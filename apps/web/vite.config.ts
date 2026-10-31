import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  // plotly.js (CommonJS) and some of its dependencies read Node's `global`.
  define: { global: 'globalThis' },
  // Pre-bundle the Plotly partial bundle's CommonJS modules at startup; discovering them on first chart
  // makes the dev server re-optimise and reload the page.
  optimizeDeps: {
    include: [
      'core',
      'scatter',
      'scattergl',
      'heatmap',
      'bar',
      'box',
      'violin',
      'histogram',
      'pie',
      'scatter3d',
    ].map((m) => `plotly.js/lib/${m}`),
  },
  server: {
    port: 5173,
    strictPort: true,
    // The SPA talks to the API through /api so the browser never needs CORS in development.
    proxy: {
      '/api': { target: apiTarget, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
});
