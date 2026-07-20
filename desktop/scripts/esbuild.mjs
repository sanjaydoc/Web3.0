// Bundle the Web3.0 node service + the Electron main process into flat, dependency-free files that
// electron-builder can package — sidestepping the pnpm-workspace symlinks entirely.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // desktop/
const repo = resolve(root, '..'); // Web3.0/
const out = resolve(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The node source uses TS-ESM import specifiers with a `.js` extension (e.g. `import './kernel.js'`).
// Map those relative `.js` specifiers to the real `.ts` files so esbuild can bundle from source.
const tsExtPlugin = {
  name: 'ts-ext',
  setup(b) {
    b.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (!args.importer || !args.path.endsWith('.js')) return;
      const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
      if (existsSync(tsPath)) return { path: tsPath };
      return undefined;
    });
  },
};

// Resolve the workspace packages to their TS source (matches the node's tsconfig paths).
const pkg = (name) => resolve(repo, `packages/web3-${name}/src/index.ts`);
const alias = {
  '@web3/crypto': pkg('crypto'),
  '@web3/core': pkg('core'),
  '@web3/ledger': pkg('ledger'),
  '@web3/consensus': pkg('consensus'),
};

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'info',
  plugins: [tsExtPlugin],
};

// The node → one CommonJS file. mongodb pulls in a pile of OPTIONAL peer deps behind try/catch;
// mark them external so esbuild doesn't fail resolving them (mongodb degrades gracefully if absent).
await build({
  ...common,
  entryPoints: [resolve(repo, 'services/web3-node/src/index.ts')],
  outfile: resolve(out, 'node-bundle.cjs'),
  alias,
  // `import.meta.url` is empty in CJS output; map it to a real file URL so env.ts can resolve paths.
  define: { 'import.meta.url': '__IMPORT_META_URL__' },
  banner: {
    js: "const __IMPORT_META_URL__ = require('node:url').pathToFileURL(__filename).href;",
  },
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
  ],
});

// The Electron main process. `electron` is provided by the runtime → keep external.
await build({
  ...common,
  entryPoints: [resolve(root, 'src/main.js')],
  outfile: resolve(out, 'main.cjs'),
  external: ['electron'],
});

// Bundle the network's genesis file when the repo has one (network.json at the root) so installed
// nodes join the network instead of booting solo. Absent file → the node still boots solo.
const genesis = resolve(repo, 'network.json');
if (existsSync(genesis)) {
  cpSync(genesis, resolve(out, 'network.json'));
  console.log('✓ bundled network.json (genesis defaults)');
}

// Copy the already-built dashboard (Vite dist) into the app payload.
const dash = resolve(repo, 'apps/dashboard/dist');
if (!existsSync(dash)) {
  console.error('dashboard build missing — run `pnpm --filter @web3/dashboard build` first');
  process.exit(1);
}
cpSync(dash, resolve(out, 'dashboard'), { recursive: true });

console.log('✓ bundled → desktop/dist (node-bundle.cjs, main.cjs, dashboard/)');
