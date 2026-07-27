// Assemble the Capacitor web payload for the Android app:
//   www/            ← the built dashboard (Vite dist), loaded by the WebView
//   www/nodejs/     ← the nodejs-mobile project: launcher + the bundled peer node + genesis config
//
// This is the mobile counterpart of desktop/scripts/esbuild.mjs. It reuses the SAME node source and
// the SAME network.json as the desktop app, so a phone joins the exact same shared chain. The node
// is bundled to ONE dependency-free CommonJS file (no node_modules needed inside the app) targeting
// Node 18 — the version nodejs-mobile ships.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // mobile/
const repo = resolve(root, '..'); // Web3.0/
const www = resolve(root, 'www');
const nodeOut = resolve(www, 'nodejs');

// 1) Build the dashboard from the monorepo. VITE_WEB3_URL is intentionally unset → the dashboard
//    defaults to http://127.0.0.1:8787, i.e. the local node this app runs. (Same as desktop.)
console.log('▸ building dashboard…');
execSync('pnpm --filter @web3/dashboard build', { cwd: repo, stdio: 'inherit' });

const dash = resolve(repo, 'apps/dashboard/dist');
if (!existsSync(dash)) {
  console.error('dashboard build missing at apps/dashboard/dist');
  process.exit(1);
}

// 2) Fresh www/ = the dashboard.
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(dash, www, { recursive: true });

// 3) The nodejs-mobile project dir.
mkdirSync(nodeOut, { recursive: true });
cpSync(resolve(root, 'nodejs-src'), nodeOut, { recursive: true });

// The node source uses TS-ESM import specifiers ending in `.js`; map them to the real `.ts` files.
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
const pkg = (name) => resolve(repo, `packages/web3-${name}/src/index.ts`);
const alias = {
  '@web3/crypto': pkg('crypto'),
  '@web3/core': pkg('core'),
  '@web3/ledger': pkg('ledger'),
  '@web3/consensus': pkg('consensus'),
};

// 4) Bundle the node → one CommonJS file, targeting Node 18 (nodejs-mobile's runtime).
console.log('▸ bundling node (target node18)…');
await build({
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  logLevel: 'info',
  plugins: [tsExtPlugin],
  entryPoints: [resolve(repo, 'services/web3-node/src/index.ts')],
  outfile: resolve(nodeOut, 'node-bundle.cjs'),
  alias,
  // `import.meta.url` is empty in CJS output; map it to a real file URL so env.ts can resolve paths.
  define: { 'import.meta.url': '__IMPORT_META_URL__' },
  banner: {
    js: "const __IMPORT_META_URL__ = require('node:url').pathToFileURL(__filename).href;",
  },
  // mongodb pulls in optional peer deps behind try/catch — keep them external (the phone runs the
  // in-memory store, so these are never loaded). Same list as the desktop bundler.
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

// 5) Genesis/peer config → joins the shared network. Reuse the desktop's network.json verbatim.
const genesis = resolve(repo, 'desktop/network.json');
if (!existsSync(genesis)) {
  console.error('desktop/network.json missing — the node would boot solo instead of joining.');
  process.exit(1);
}
cpSync(genesis, resolve(nodeOut, 'network.json'));

console.log(
  '✓ prepared mobile payload → www/ (dashboard) + www/nodejs/ (launcher + node-bundle.cjs + network.json)',
);
