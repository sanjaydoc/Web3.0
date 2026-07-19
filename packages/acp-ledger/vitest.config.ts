import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve @acp/* workspace packages by absolute path so Vitest does not rely on
// pnpm symlink resolution — which breaks on Windows and on paths containing spaces
// (e.g. "C:\\Users\\me\\All Apps\\Web3.0"). See README troubleshooting.
const src = (pkg: string) =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@acp/crypto': src('acp-crypto'),
      '@acp/core': src('acp-core'),
      '@acp/ledger': src('acp-ledger'),
      '@acp/consensus': src('acp-consensus'),
    },
  },
});
