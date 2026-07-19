# Web3.0 desktop (Electron)

A native desktop app that **runs a Web3.0 node and shows the dashboard** in one window — double-click,
no terminal. Produces a Windows **`.msi`** and **`.exe`** installer.

## How it works
- `src/main.js` — the Electron main process. On launch it spawns the bundled node
  (`utilityProcess`), waits for `/health`, then loads the dashboard in a `BrowserWindow`. It keeps a
  stable node identity (`WEB3_NODE_SEED`) in the app's userData and shuts the node down on quit.
- `build/esbuild.mjs` — bundles the whole node service (`@web3/node` + its workspace packages + npm
  deps) into a single `dist/node-bundle.cjs`, and the main process into `dist/main.cjs`. This
  sidesteps the pnpm-workspace symlinks entirely — there are no `node_modules` to package.
- `electron-builder.yml` — packages `dist/` (main + node bundle + dashboard) into installers.

The node runs **in-memory by default** in the desktop app (no Mongo). To persist, set
`WEB3_MONGODB_URI` in the environment before launching, or run the standalone node instead.

## Build the installer

### The easy way — GitHub Actions (no toolchain needed)
Push a version tag and the `desktop` workflow builds the `.msi` + `.exe` on a Windows runner and
attaches them to a GitHub Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```
Then download the installers from the release. You can also trigger it manually from the Actions tab
("Run workflow").

### Locally on Windows
Prereqs: Node 20+, pnpm, and (for a custom icon) nothing extra — electron-builder handles the rest.

```bash
pnpm install            # once, at the repo root (for the dashboard build)
cd desktop
npm install             # electron, electron-builder, esbuild
npm run dist            # → desktop/release/*.msi and *.exe
```

Run it live without packaging:
```bash
cd desktop
npm install
npm run dev             # builds, bundles, and launches the app
```

## Icon (optional)
Drop a 256×256 `assets/icon.ico` to brand the app and installer; otherwise the default Electron icon
is used.

## Signing
The installers are **unsigned** — Windows SmartScreen shows an "unknown publisher" prompt (click
"More info → Run anyway"). To sign later, add a certificate (Microsoft Store, Azure Trusted Signing,
or an OV/EV cert) — it's a final step layered on top of the same build.
