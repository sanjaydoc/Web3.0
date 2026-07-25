// Web3.0 desktop — Electron shell. A native window onto the ONE shared Web3.0 network: it loads the
// dashboard, which talks to the canonical node baked in at build time (VITE_WEB3_URL). The app does
// NOT run its own node — every desktop user is on the same shared network as everyone else, not an
// isolated island. (Contributing your own peer node to the chain is a later release.)
const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');

let win = null;

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
      // The dashboard loads from file:// and calls the network node over HTTPS. Disabling
      // webSecurity lets our own first-party UI make those cross-origin API calls without the node
      // having to allow a null/file origin. The window only ever loads our bundled dashboard.
      webSecurity: false,
    },
  });

  // External links open in the OS browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

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
}
