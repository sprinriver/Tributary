import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { cspHeader } from './src/security/csp.ts';
import { molstarNoEval } from './src/security/molstar-no-eval.ts';

const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3000';

// The production Content-Security-Policy (CloudFront sends it); the dev server also allows inline scripts.
// Browser uploads go to object storage: the local SeaweedFS endpoint unless S3_ENDPOINT says otherwise.
const policy = JSON.parse(
  readFileSync(new URL('../../infra/terraform/modules/cloudfront/csp.json', import.meta.url), 'utf8'),
) as Record<string, string[]>;
const uploadOrigin = new URL(process.env.S3_ENDPOINT ?? 'http://localhost:8333').origin;
const csp = (dev: boolean) => ({ 'Content-Security-Policy': cspHeader(policy, { uploadOrigin, dev }) });

export default defineConfig({
  // molstarNoEval: the CSP has no 'unsafe-eval' (src/security/molstar-no-eval.ts).
  plugins: [react(), molstarNoEval()],
  // Mol* movie export's encoder needs eval; the 3D view does not offer movie export (src/security/no-mp4-encoder.ts).
  resolve: {
    alias: {
      'h264-mp4-encoder': fileURLToPath(new URL('./src/security/no-mp4-encoder.ts', import.meta.url)),
    },
  },
  // plotly.js (CommonJS) and some of its dependencies read Node's `global`.
  define: { global: 'globalThis' },
  // Pre-bundle the Plotly partial bundle's CommonJS modules at startup; discovering them on first chart
  // makes the dev server re-optimise and reload the page.
  optimizeDeps: {
    // The dev server's pre-bundle gets the same Mol* rewrite as the build.
    rolldownOptions: { plugins: [molstarNoEval()] },
    include: ['core', 'scatter', 'heatmap', 'bar', 'box', 'violin', 'histogram', 'pie', 'scatter3d']
      .map((m) => `plotly.js/lib/${m}`)
      .concat('plotly.js/src/traces/scattergl/strict'),
  },
  // `vite preview` (CI e2e) serves the production build on the same port, with server.proxy for /api.
  preview: { port: 5173, strictPort: true, headers: csp(false) },
  server: {
    port: 5173,
    strictPort: true,
    headers: csp(true),
    // The SPA talks to the API through /api so the browser never needs CORS in development.
    proxy: {
      '/api': { target: apiTarget, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
});
