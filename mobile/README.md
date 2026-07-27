# Web3.0 mobile — a full peer node in your pocket

An Android app that runs a **real Web3.0 peer node on the phone** (via
[nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile), wrapped by
[`capacitor-nodejs`](https://github.com/hampoelz/Capacitor-NodeJS)) and shows the dashboard in a
Capacitor WebView. It is the mobile counterpart of the desktop app: same bundled node, same
`network.json`, same dashboard — so a phone is a first-class participant in the one shared chain, not
a thin client.

## How it works

```
┌─────────────────────────── Android app ───────────────────────────┐
│  WebView (dashboard, apps/dashboard/dist)                          │
│        │  http://127.0.0.1:8787                                    │
│        ▼                                                           │
│  nodejs-mobile runtime  ──►  nodejs/server.js (launcher)           │
│                              └─► node-bundle.cjs (the peer node)   │
│                                   • dials the network authority    │
│                                     over /consensus (network.json) │
│                                   • replicates the ledger          │
│                                   • forwards signed transactions   │
└────────────────────────────────────────────────────────────────────┘
```

- The dashboard defaults to `http://127.0.0.1:8787` (VITE_WEB3_URL unset), so it talks to the node
  running **on the device**. Because that node is a normal own-node (not the admin-only main node),
  the dashboard shows the same **"Run a node — quick setup" onboarding** and full operator console as
  the desktop app.
- The node runs the **in-memory store** on device; chain state re-syncs from the authority on
  reconnect. The node identity **seed**, GUI **config**, and account keys persist (seed/config under
  the plugin's `getDataPath()`, account keys in the WebView's localStorage).

## Layout

```
mobile/
├─ capacitor.config.json      appId com.web3.mobile, webDir=www, CapacitorNodeJS plugin
├─ nodejs-src/                the nodejs-mobile project (committed source)
│  ├─ package.json            main: server.js
│  └─ server.js               launcher: sets env (host/port/seed/network) → requires node-bundle.cjs
├─ scripts/prepare.mjs        builds dashboard + bundles node (target node18) → www/ + www/nodejs/
├─ android/                   the Capacitor Android project (committed; build outputs gitignored)
│  └─ app/src/main/res/xml/network_security_config.xml   cleartext to 127.0.0.1 only
└─ www/                       generated web payload (gitignored)
```

## Build

Requires JDK 17+ and the Android SDK for the Gradle step.

```bash
# from the repo root, install workspace deps once:  pnpm install
cd mobile
npm install                # Capacitor + capacitor-nodejs (from GitHub release tarball) + esbuild
npm run prepare:app        # build dashboard + bundle node → www/
npx cap sync android       # copy www/ (incl. nodejs project) into the android assets
npm run apk:debug          # → android/app/build/outputs/apk/debug/app-debug.apk
```

CI builds the debug APK on every push under `mobile/**` — see `.github/workflows/android.yml`.

## Notes / constraints (nodejs-mobile)

- Runtime is **Node 18.20** — the node bundle is compiled with `--target=node18`.
- No `child_process` (the node doesn't use it); `os.cpus()` may be `undefined` (guarded).
- **minSdk 24** (nodejs-mobile needs ≥22). ABIs shipped: arm64-v8a, armeabi-v7a, x86_64.
- The upstream nodejs-mobile toolkit is in maintenance mode; this is the pragmatic way to run a full
  Node runtime inside Capacitor today.
