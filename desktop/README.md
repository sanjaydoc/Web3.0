# Web3.0 desktop (Electron)

A native desktop app that **runs a Web3.0 node and shows the dashboard** in one window — double-click,
no terminal. Produces a Windows **`.msi`** + **`.exe`**, a macOS **`.dmg`** (universal), and a Linux
**`.AppImage`** + **`.deb`**.

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
Push a version tag and the `desktop` workflow builds on three native runners in parallel — Windows
`.msi` + `.exe`, macOS `.dmg` (universal), Linux `.AppImage` + `.deb` — then attaches them all to a
GitHub Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```
Then download the installers from the release. You can also trigger it manually from the Actions tab
("Run workflow"). Note: macOS runners bill at 10× on private repos.

### Locally on Windows
Prereqs: Node 20+, pnpm, and (for a custom icon) nothing extra — electron-builder handles the rest.

```bash
pnpm install            # once, at the repo root (for the dashboard build)
cd desktop
npm install             # electron, electron-builder, esbuild
npm run dist            # Windows → desktop/release/*.msi and *.exe
npm run dist:linux      # Linux   → desktop/release/*.AppImage and *.deb
npm run dist:mac        # macOS   → desktop/release/*.dmg   (run on a Mac)
```

> Each OS's installer must be built on that OS (a `.dmg` only builds on macOS, `.msi` on Windows).
> The GitHub Actions route above handles all three for you.

Run it live without packaging:
```bash
cd desktop
npm install
npm run dev             # builds, bundles, and launches the app
```

## Icon
`assets/icon.ico` brands the Windows app/installer; `assets/icon.png` (1024×1024) brands the macOS and
Linux apps (electron-builder derives the `.icns` and Linux sizes from it). Both are the monochrome
**W3** mark from the dashboard theme.

Regenerate them from the single source SVG with `node scripts/make-icon.mjs` (needs the pre-installed
Chromium). The `.ico` is written with **uncompressed 32-bit BMP entries at every size** (256→16) — the
naive "PNG per size" approach can embed near-empty small images, which makes Windows show a blank
shortcut icon (the desktop + taskbar use the 16/32/48 sizes).

## Signing
The installers are **unsigned**:
- **Windows** — SmartScreen shows an "unknown publisher" prompt (click "More info → Run anyway"). To
  sign later, add a certificate (Microsoft Store, Azure Trusted Signing, or an OV/EV cert).
- **macOS** — Gatekeeper blocks it on first launch; right-click the app → **Open** (or run
  `xattr -cr /Applications/Web3.0.app`). To ship it cleanly, sign with an Apple **Developer ID**
  ($99/yr) and notarize — the CI job passes `CSC_IDENTITY_AUTO_DISCOVERY=false` today so it ad-hoc
  signs instead of failing on a missing cert.

Signing is a final step layered on top of the same build.
