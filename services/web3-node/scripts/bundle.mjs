// Bundle the Web3.0 node service into a single flat CommonJS file — compiled, dependency-free, and
// source-free. This is what ships in the public Docker image and the desktop app: the container/app
// gets `node-bundle.cjs` only, never the TypeScript source or the private workspace packages.
//
// Usage: node services/web3-node/scripts/bundle.mjs [outfile]   (default: services/web3-node/dist/node-bundle.cjs)
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..'); // Web3.0/
const outfile = resolve(process.argv[2] ?? resolve(here, '../dist/node-bundle.cjs'));

// The node source uses TS-ESM import specifiers with a `.js` extension (e.g. `import './kernel.js'`).
// Map those relative `.js` specifiers to the real `.ts` files so esbuild can bundle from source.
const tsExtPlugin = {
  name: 'ts-ext',
  setup(b) {
    b.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (!args.importer || !args.path.endsWith('.js')) return;
      const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
      return existsSync(tsPath) ? { path: tsPath } : undefined;
    });
  },
};

// Resolve the workspace packages to their TS source (matches the node's tsconfig paths).
const pkg = (name) => resolve(repo, `packages/web3-${name}/src/index.ts`);

await build({
  entryPoints: [resolve(repo, 'services/web3-node/src/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'info',
  plugins: [tsExtPlugin],
  alias: {
    '@web3/crypto': pkg('crypto'),
    '@web3/core': pkg('core'),
    '@web3/ledger': pkg('ledger'),
    '@web3/consensus': pkg('consensus'),
  },
  // `import.meta.url` is empty in CJS output; map it to a real file URL so env.ts can resolve paths.
  define: { 'import.meta.url': '__IMPORT_META_URL__' },
  banner: {
    js: "const __IMPORT_META_URL__ = require('node:url').pathToFileURL(__filename).href;",
  },
  // mongodb + pg pull in OPTIONAL peer deps behind try/catch — mark them external so esbuild doesn't
  // fail resolving them; both drivers degrade gracefully (pure-JS path) if they're absent at runtime.
  external: [
    'bufferutil',
    'utf-8-validate',
    'mongodb-client-encryption',
    '@mongodb-js/zstd',
    'kerberos',
    'snappy',
    'aws4',
    'gcp-metadata',
    'socks',
    '@aws-sdk/credential-providers',
    'pg-native',
    'pg-cloudflare',
    'cloudflare:sockets',
  ],
});

console.log('✓ bundled node →', outfile);
