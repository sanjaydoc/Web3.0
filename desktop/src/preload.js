// Preload — the ONLY bridge between the dashboard (renderer) and the Electron main process. It
// exposes a tiny, explicit `window.web3desktop` API so the dashboard can start/stop the local node
// and read whether it's running. contextIsolation keeps this the sole surface (no Node in the page).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('web3desktop', {
  // Lets the dashboard show the desktop-only Start/Stop control (absent on the web console).
  isDesktop: true,
  /** Start the local peer node (idempotent). Resolves { running }. */
  startNode: () => ipcRenderer.invoke('node:start'),
  /** Stop the local peer node. Resolves { running: false }. */
  stopNode: () => ipcRenderer.invoke('node:stop'),
  /** Whether the local node process is currently running. Resolves { running }. */
  nodeStatus: () => ipcRenderer.invoke('node:status'),
});
