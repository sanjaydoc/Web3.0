// Web3.0 mobile node launcher — the nodejs-mobile entry point.
//
// This runs INSIDE the phone's embedded Node.js runtime (capacitor-nodejs / nodejs-mobile). It is
// the mobile analogue of desktop/src/main.js's startNode(): it configures the environment, then
// boots the exact same bundled peer node (node-bundle.cjs) so the phone becomes a REAL participant
// in the one shared chain — dialing the network authority over /consensus, replicating the ledger,
// and forwarding this user's account-signed transactions. The WebView then loads the dashboard
// pointed at this LOCAL node (http://127.0.0.1:8787).
//
// nodejs-mobile notes baked in below:
//   • The project dir (__dirname) is READ-ONLY-ish: it is re-extracted from the APK on every app
//     update, so anything we must keep (the node identity seed, GUI config) is written under the
//     plugin's persistent data path instead.
//   • No child_process; os.cpus() may be undefined (the node guards that). We only bind a loopback
//     HTTP/WS server, which is the supported path.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// nodejs-mobile runs Node 18, where the Web Crypto API is NOT exposed as the global `crypto` (that
// only became a global in Node 19+). @noble/post-quantum needs `crypto.getRandomValues` for key
// generation, so without this the node throws "crypto.getRandomValues must be defined" at boot →
// process.exit(1) → the whole app crashes on launch. Polyfill the global from node:crypto's
// webcrypto (present since Node 15) before the node boots.
if (!globalThis.crypto && crypto.webcrypto) {
  globalThis.crypto = crypto.webcrypto;
}

// Defense in depth: nodejs-mobile turns an uncaught error or process.exit() in the node thread into
// a NATIVE app crash. Log unexpected errors instead of dying, and make process.exit a no-op so a
// boot failure degrades to "node offline" (the dashboard shows a connection error) rather than
// taking the whole app down.
process.on('uncaughtException', (e) => console.error('[node] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[node] unhandledRejection:', e));
process.exit = (code) => console.error(`[node] process.exit(${code}) suppressed on mobile`);

const HOST = '127.0.0.1';
const PORT = 8787;

/** The plugin's persistent, app-private data dir — survives app updates (unlike __dirname). Falls
 *  back to a local dir when run outside nodejs-mobile (e.g. a desktop smoke test). */
function dataDir() {
  try {
    const { getDataPath } = require('bridge');
    const p = getDataPath();
    if (p && typeof p === 'string') return p;
  } catch {
    /* not running under nodejs-mobile — fall through */
  }
  const local = path.join(__dirname, '.web3-data');
  try {
    fs.mkdirSync(local, { recursive: true });
  } catch {
    /* best effort */
  }
  return local;
}

/** A stable 32-byte node seed persisted in the data dir — keeps this install's node identity (and
 *  any authority stake) constant across restarts and app updates. */
function nodeSeed(dir) {
  const file = path.join(dir, 'node-seed');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* first run — generate below */
  }
  const seed = crypto.randomBytes(32).toString('base64url');
  try {
    fs.writeFileSync(file, seed, { mode: 0o600 });
  } catch {
    /* non-fatal: fall back to an ephemeral identity for this session */
  }
  return seed;
}

const dir = dataDir();
const networkFile = path.join(__dirname, 'network.json');

// Configure the node before it reads its config. Same knobs desktop/src/main.js sets.
process.env.WEB3_HOST = HOST;
process.env.WEB3_PORT = String(PORT);
process.env.WEB3_NODE_SEED = nodeSeed(dir);
process.env.WEB3_LOG_LEVEL = process.env.WEB3_LOG_LEVEL || 'info';
// Keep the node's GUI-saved settings + store-mode marker in the persistent data dir (NOT the
// project dir, which is wiped on update; NOT the home dir, which is unreliable on Android).
process.env.WEB3_CONFIG_PATH = path.join(dir, 'config.json');
process.env.WEB3_STORE_MODE_FILE = path.join(dir, 'store-mode');
// A phone has no database, so persist node state (the operator's created AGENTS, the hosted-agent
// config, Telegram config, and this node's own ledger entries) to JSON files in the persistent data
// dir — otherwise it all lives in RAM and is wiped every time the app is closed. Balances/history
// still rebuild from the network re-sync; this is what makes an operator's agents survive a restart.
process.env.WEB3_STORE_PATH = path.join(dir, 'store');
// The bundled genesis/peer config makes the node JOIN the shared network instead of booting solo.
if (fs.existsSync(networkFile)) process.env.WEB3_NETWORK_FILE = networkFile;

// Boot the real peer node.
require('./node-bundle.cjs');
