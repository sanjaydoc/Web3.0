// Web3.0 desktop — Electron shell. Starts the bundled node, waits for it to be healthy, then shows
// the dashboard in a native window. Node is a child (utilityProcess) killed on quit.
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, shell, utilityProcess } = require('electron');

const NODE_PORT = 8787;
const NODE_URL = `http://127.0.0.1:${NODE_PORT}`;
let nodeProc = null;
let win = null;

/** A stable signing seed in userData so the node keeps one identity across restarts. */
function nodeSeed() {
  const file = path.join(app.getPath('userData'), 'node-seed.txt');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const seed = crypto.randomBytes(32).toString('base64url');
    try {
      fs.writeFileSync(file, seed);
    } catch {
      /* best effort */
    }
    return seed;
  }
}

function startNode() {
  const bundle = path.join(__dirname, 'node-bundle.cjs');
  nodeProc = utilityProcess.fork(bundle, [], {
    env: {
      ...process.env,
      WEB3_HOST: '127.0.0.1',
      WEB3_PORT: String(NODE_PORT),
      WEB3_NODE_SEED: nodeSeed(),
      WEB3_LOG_LEVEL: 'info',
    },
    stdio: 'inherit',
  });
}

function health() {
  return new Promise((res) => {
    const req = http.get(`${NODE_URL}/health`, (r) => {
      r.resume();
      res(r.statusCode === 200);
    });
    req.on('error', () => res(false));
    req.setTimeout(1000, () => {
      req.destroy();
      res(false);
    });
  });
}

async function waitForNode(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await health()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const LOADING = `data:text/html,${encodeURIComponent(
  `<!doctype html><html><head><meta charset=utf-8><style>
  html,body{height:100%;margin:0;background:#05060a;color:#e8ecf4;font-family:system-ui,sans-serif;display:grid;place-items:center}
  .b{text-align:center}.s{width:34px;height:34px;border:3px solid #22e3a733;border-top-color:#22e3a7;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
  @keyframes spin{to{transform:rotate(360deg)}}.t{font-size:1.05rem;color:#9aa6bd}
  </style></head><body><div class=b><div class=s></div><div class=t>Starting your Web3.0 node…</div></div></body></html>`,
)}`;

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#05060a',
    title: 'Web3.0',
    webPreferences: { contextIsolation: true },
  });
  // External links open in the OS browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  await win.loadURL(LOADING);
  startNode();
  await waitForNode();
  await win.loadFile(path.join(__dirname, 'dashboard', 'index.html'));
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
  app.whenReady().then(createWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (nodeProc) {
      try {
        nodeProc.kill();
      } catch {
        /* already gone */
      }
    }
  });
}
