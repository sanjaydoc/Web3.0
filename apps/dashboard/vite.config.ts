import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built dashboard also loads from a file:// path (the Electron desktop app),
  // not just when served from a web root.
  base: './',
  plugins: [react()],
  server: { port: 5173 },
});
