# ACP Node — desktop app (scaffold)

A **native desktop shell** (Tauri) that wraps the Web3.0 dashboard in a WebView so an operator can
**double-click to run and manage a node** — producing real installers: **Windows `.msi`/`.exe`,
macOS `.dmg`, Linux `.AppImage`/`.deb`**.

> **Status: scaffold.** These files are the starting point for the roadmap "Desktop node app" item.
> Building the installers needs a native toolchain (Rust + each OS's build tools + code-signing),
> which can't run in the project's CI Linux sandbox — so this is built on your own machine.

## What's here
- `src-tauri/tauri.conf.json` — app + bundle config; `frontendDist` points at the dashboard build,
  and `beforeBuildCommand` builds the dashboard first. Bundle targets: `msi, nsis, dmg, appimage, deb`.
- `src-tauri/src/main.rs` — the WebView shell (loads the bundled dashboard).
- `src-tauri/Cargo.toml`, `build.rs` — Rust/Tauri build.
- `package.json` — `pnpm dev` / `pnpm build` via the Tauri CLI.

## Build the installers (on the target OS)
Prereqs: **Rust** (`rustup`), **Node 20+/pnpm**, and Tauri's OS deps (see tauri.app → Prerequisites;
on Windows that's the WebView2 runtime + MSVC build tools).

```bash
cd desktop
pnpm install
pnpm build          # → src-tauri/target/release/bundle/{msi,nsis,dmg,appimage,deb}/...
# or run it live:  pnpm dev
```
The `.msi` (Windows), `.dmg` (macOS), and `.AppImage`/`.deb` (Linux) land under
`src-tauri/target/release/bundle/`.

## Making it truly one-click (next packaging step)
The shell shows the dashboard; the **node** still needs to run. Two ways to bundle it:
1. **Sidecar binary** — compile the node to a single executable (e.g. with `pkg`/`bun build`),
   add it to `tauri.conf.json` → `bundle.externalBin`, and spawn it on startup from `main.rs`
   via `tauri-plugin-shell` (already a dependency). The WebView then talks to `127.0.0.1:8787`.
2. **Embedded runtime** — ship Node + the node service inside the app resources and launch with a
   bundled `node`.

Both are deliberately left out of the default scaffold so it compiles cleanly without the heavier
packaging work. Wire one of them to reach the full "no terminal, double-click" experience.

## Icon
Add `src-tauri/icons/icon.png` (1024×1024). Generate the platform icon set with
`pnpm tauri icon path/to/icon.png`.
