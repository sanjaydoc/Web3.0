import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

/**
 * Stamp the service worker with a per-build id so every deploy ships a byte-different `sw.js`. The
 * browser then detects the update, installs the new worker, and its `activate` purges the old cache
 * (whose name embeds this id). Without this, `sw.js` was identical every release, so the browser never
 * saw an update and returning visitors could keep a stale cached shell — showing as a blank page after
 * a redeploy. The id is derived from the hashed entry-JS filename (already content-addressed), so it
 * changes iff the app changes; falls back to a timestamp if the asset can't be found.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const dist = resolve(__dirname, 'dist');
      const swPath = resolve(dist, 'sw.js');
      const htmlPath = resolve(dist, 'index.html');
      if (!existsSync(swPath) || !existsSync(htmlPath)) return;
      const html = readFileSync(htmlPath, 'utf8');
      const match = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
      const buildId = match ? match[1] : String(Date.now());
      const sw = readFileSync(swPath, 'utf8').replaceAll('__BUILD_ID__', buildId);
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  // Relative base so the built dashboard also loads from a file:// path (the Electron desktop app),
  // not just when served from a web root.
  base: './',
  plugins: [react(), stampServiceWorker()],
  server: { port: 5173 },
});
