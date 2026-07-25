// Web3.0 desktop — Electron shell that runs a REAL peer node of the one shared network.
//
// Unlike the thin client, this launches the bundled node (node-bundle.cjs) as a child process
// configured from the bundled network.json: it dials the network's authority over the /consensus
// WebSocket, replicates the full chain, relays gossip to other peers, and forwards this user's
// account-signed transactions to be sealed. The window then loads the dashboard pointed at the
// LOCAL node (127.0.0.1). So every desktop is a first-class participant in the shared chain — not
// a thin client, not an island.
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');

const NODE_HOST = '127.0.0.1';
const NODE_PORT = 8787;
const NODE_URL = `http://${NODE_HOST}:${NODE_PORT}`;

let win = null;
let nodeProc = null;

/** A stable 32-byte node seed, persisted in userData — keeps this install's node identity (and any
 *  authority stake) constant across restarts. */
function nodeSeed() {
  const file = path.join(app.getPath('userData'), 'node-seed');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* first run — generate below */
  }
  const seed = randomBytes(32).toString('base64url');
  try {
    fs.writeFileSync(file, seed, { mode: 0o600 });
  } catch {
    /* non-fatal: fall back to an ephemeral identity for this session */
  }
  return seed;
}

/** Launch the bundled node as a child process (Electron-as-node), joining the shared network. */
function startNode() {
  const bundle = path.join(__dirname, 'node-bundle.cjs');
  const networkFile = path.join(__dirname, 'network.json');
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1', // run the Electron binary as a plain Node runtime
    WEB3_HOST: NODE_HOST,
    WEB3_PORT: String(NODE_PORT),
    WEB3_NODE_SEED: nodeSeed(),
    WEB3_LOG_LEVEL: 'info',
    // Keep the node's GUI-saved settings next to the app's user data.
    WEB3_CONFIG_PATH: path.join(app.getPath('userData'), 'config.json'),
  };
  // The bundled genesis/peer config makes the node JOIN the shared network (authorities + peers).
  if (fs.existsSync(networkFile)) env.WEB3_NETWORK_FILE = networkFile;

  nodeProc = spawn(process.execPath, [bundle], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  nodeProc.stdout.on('data', (d) => process.stdout.write(`[node] ${d}`));
  nodeProc.stderr.on('data', (d) => process.stderr.write(`[node] ${d}`));
  nodeProc.on('exit', (code) => {
    nodeProc = null;
    if (code && code !== 0) console.error(`[node] exited with code ${code}`);
  });
}

/** Resolve once the local node answers /health, so we don't load the dashboard against a dead port. */
function waitForNode(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${NODE_URL}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(2_000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('node did not become healthy in time'));
      else setTimeout(attempt, 400);
    };
    attempt();
  });
}

const LOADING_HTML = `data:text/html,${encodeURIComponent(
  `<html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#fff;
   font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0d0d0f">
   <div style="text-align:center">
     <div style="font-size:22px;font-weight:600">Web3.0</div>
     <div style="margin-top:8px;color:#666">Starting your node and joining the network…</div>
   </div></body></html>`,
)}`;

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#ffffff',
    title: 'Web3.0',
    webPreferences: {
      contextIsolation: true,
      // The dashboard loads from file:// and calls the LOCAL node over http. Disabling webSecurity
      // lets our own first-party UI make those calls without a null-origin CORS dance. The window
      // only ever loads our bundled dashboard.
      webSecurity: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  await win.loadURL(LOADING_HTML);
  try {
    await waitForNode();
  } catch (err) {
    console.error(err);
    // Load the dashboard anyway — it shows its own connection error if the node is still down.
  }
  await win.loadFile(path.join(__dirname, 'dashboard', 'index.html'));
}

function stopNode() {
  if (nodeProc) {
    nodeProc.kill();
    nodeProc = null;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    startNode();
    createWindow();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', stopNode);
  app.on('will-quit', stopNode);
}
