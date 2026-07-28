import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve @web3/* workspace packages by absolute path so Vitest does not rely on
// pnpm symlink resolution — which breaks on Windows and on paths containing spaces
// (e.g. "C:\\Users\\me\\All Apps\\Web3.0"). See README troubleshooting.
const src = (pkg: string) =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@web3/crypto': src('web3-crypto'),
      '@web3/core': src('web3-core'),
      '@web3/ledger': src('web3-ledger'),
      '@web3/consensus': src('web3-consensus'),
    },
  },
});
