import { useState } from 'react';

const REPO = 'https://github.com/sanjaydoc/Web3.0';

// The packaged Windows desktop app (Electron) — runs a node + opens the dashboard in one window.
// Published by the `desktop` workflow on every version tag.
const DESKTOP_VERSION = '0.1.0';
const DESKTOP_RELEASE = `${REPO}/releases/latest`;
const DL = `${REPO}/releases/download/v${DESKTOP_VERSION}`;
const DESKTOP_EXE = `${DL}/Web3.0.Setup.${DESKTOP_VERSION}.exe`;
const DESKTOP_MSI = `${DL}/Web3.0.${DESKTOP_VERSION}.msi`;
const DESKTOP_DMG = `${DL}/Web3.0-${DESKTOP_VERSION}-universal.dmg`;
const DESKTOP_APPIMAGE = `${DL}/Web3.0-${DESKTOP_VERSION}.AppImage`;
const DESKTOP_DEB = `${DL}/web3_${DESKTOP_VERSION}_amd64.deb`;

const INSTALL_SCRIPT = `#!/usr/bin/env bash
# Run a Web3.0 node on macOS or Linux.
# Installs Node.js 20+ and git automatically if they're missing.
set -euo pipefail
REPO="\${WEB3_REPO:-${REPO}.git}"
DIR="\${WEB3_DIR:-web3-node}"

have() { command -v "$1" >/dev/null 2>&1; }

# Install a package with whatever package manager this machine has.
pkg_install() {
  if have brew;    then brew install "$@"
  elif have apt-get; then sudo apt-get update -y && sudo apt-get install -y "$@"
  elif have dnf;   then sudo dnf install -y "$@"
  elif have yum;   then sudo yum install -y "$@"
  elif have pacman; then sudo pacman -Sy --noconfirm "$@"
  elif have zypper; then sudo zypper install -y "$@"
  else return 1; fi
}

if ! have git; then
  echo "→ installing git…"
  pkg_install git || { echo "Please install git: https://git-scm.com"; exit 1; }
fi
if ! have node; then
  echo "→ installing Node.js…"
  pkg_install node || pkg_install nodejs || { echo "Please install Node 20+: https://nodejs.org"; exit 1; }
fi
# Warn (don't fail) if the Node major version is < 20.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "\${NODE_MAJOR:-0}" -ge 20 ] || echo "⚠ Node \${NODE_MAJOR} found; Web3.0 wants 20+. If it errors, upgrade via nvm: https://github.com/nvm-sh/nvm"

[ -d "$DIR" ] || git clone --depth 1 "$REPO" "$DIR"
cd "$DIR"
corepack enable >/dev/null 2>&1 || npm install -g pnpm
pnpm install
[ -f .env ] || cp .env.example .env
pnpm --filter @web3/node start
`;

const INSTALL_PS1 = `# Run a Web3.0 node on Windows (PowerShell).
# Installs Node.js 20+ and git automatically (via winget) if they're missing.
# Usage:  powershell -ExecutionPolicy Bypass -File install-web3-node.ps1
$ErrorActionPreference = "Stop"
$Repo = if ($env:WEB3_REPO) { $env:WEB3_REPO } else { "${REPO}.git" }
$Dir  = if ($env:WEB3_DIR)  { $env:WEB3_DIR }  else { "web3-node" }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Have git) -or -not (Have node)) {
  if (-not (Have winget)) {
    throw "Install git (https://git-scm.com) and Node.js 20+ (https://nodejs.org), then re-run. (winget not found — update 'App Installer' from the Microsoft Store to auto-install.)"
  }
  if (-not (Have git))  { Write-Host "-> installing git…";      winget install --id Git.Git         -e --accept-package-agreements --accept-source-agreements }
  if (-not (Have node)) { Write-Host "-> installing Node.js…";  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements }
  # winget updates PATH for new shells, not this one — refresh it so we can continue now.
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  if (-not (Have git) -or -not (Have node)) {
    throw "Installed git/Node — please CLOSE this window, open a new PowerShell, and run this script again."
  }
}
if (-not (Test-Path $Dir)) { git clone --depth 1 $Repo $Dir }
Set-Location $Dir
corepack enable 2>$null
if ($LASTEXITCODE -ne 0) { npm install -g pnpm }
pnpm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
pnpm --filter '@web3/node' start
`;

interface Platform {
  name: string;
  tag: string;
  steps: string;
  note?: string;
}

const PLATFORMS: Platform[] = [
  {
    name: 'Windows · Mac · Linux',
    tag: 'Node.js',
    steps: `# 1) install Node.js 20+ and git (skip if you already have them)
#    Windows:  winget install OpenJS.NodeJS.LTS Git.Git
#    macOS:    brew install node git
#    Linux:    sudo apt install -y nodejs git   # or dnf/pacman

# 2) get the node running
git clone ${REPO}.git
cd Web3.0
npm install -g pnpm && pnpm install
cp .env.example .env
pnpm --filter @web3/node start`,
    note: 'The one-click installers above set up Node.js 20+ and git for you. The dashboard runs with `pnpm --filter @web3/dashboard dev`.',
  },
  {
    name: 'Server',
    tag: 'Docker',
    steps: `# No Node.js or git needed on the host — only Docker.
# Node 20 runs inside the image; build straight from the repo:
docker build -t web3-node ${REPO}.git
docker run -p 8787:8787 -e WEB3_MONGODB_URI=... web3-node

# (or with git, to edit .env locally first)
# git clone ${REPO}.git && cd Web3.0
# docker build -t web3-node . && docker run -p 8787:8787 --env-file .env web3-node`,
    note: 'The host needs only Docker — Node.js is inside the container. Set WEB3_MONGODB_URI (Atlas) to persist; put it behind a reverse proxy for TLS.',
  },
  {
    name: 'Android phone · tablet',
    tag: 'Termux',
    steps: `pkg install nodejs git
git clone ${REPO}.git && cd Web3.0
npm install -g pnpm && pnpm install
pnpm --filter @web3/node start`,
    note: 'Install Termux from F-Droid. A relay/host node runs comfortably on a phone.',
  },
  {
    name: 'iPhone · iPad',
    tag: 'Remote',
    steps: `# iOS can't run a node directly. Run one on a
# server (Docker card) or a spare PC, then open
# the dashboard from Safari to manage it.`,
    note: 'The dashboard is mobile-friendly — operate your node from any browser.',
  },
];

function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const ArrowDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);

/** A copy-able terminal command line ($ prompt + copy button). */
function CmdLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="term-cmd">
      <span className="dollar">$</span>
      <code>{command}</code>
      <button
        type="button"
        className={`copy ${copied ? 'copied' : ''}`}
        title="Copy"
        onClick={() => {
          navigator.clipboard.writeText(command).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            },
            () => undefined,
          );
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

const NODE_CMDS = [
  `git clone ${REPO}.git && cd Web3.0`,
  'python -m venv .venv && source .venv/bin/activate',
  'pnpm install',
  'pip install -e packages/web3-sdk-py',
  'pnpm --filter @web3/node start',
];

/** The macOS-style terminal window: copy-able setup commands + a live boot readout. */
function NodeTerminal() {
  return (
    <div className="term">
      <div className="term-bar">
        <div className="term-dot" style={{ background: '#ff5f57' }} />
        <div className="term-dot" style={{ background: '#ffbd2e' }} />
        <div className="term-dot" style={{ background: '#28c840' }} />
        <span className="term-name">web3-node — terminal</span>
      </div>
      <div className="term-body">
        {NODE_CMDS.map((c) => (
          <CmdLine key={c} command={c} />
        ))}
        <div className="term-out">
          <div>
            <span className="tl-cyan">⟳ Installing Node.js 20+, git &amp; dependencies…</span>
          </div>
          <div>
            <span className="tl-gold">⟳ Deriving node identity — ML-DSA (post-quantum)…</span>
          </div>
          <div>
            <span className="tl-out">&nbsp;&nbsp;✓ registry ✓ relay ✓ payments ✓ consensus</span>
          </div>
          <div>
            <span className="tl-out">&nbsp;&nbsp;✓ ledger verified · chain intact</span>
          </div>
          <div>
            <span className="tl-cyan">⟳ Listening on http://127.0.0.1:8787</span>
          </div>
          <div>
            <span className="tl-gold">✓ Node online → hosting agents, earning aETH</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const WindowsLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="M3 5.5L11 4v8H3V5.5zM13 4l8 1.5V12h-8V4zM3 13h8v7.5L3 19V13zM13 13h8v6l-8 1.5V13z"
      fill="#00adef"
    />
  </svg>
);
const AppleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
      fill="#ccc"
    />
  </svg>
);
const UbuntuLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="#e95420" strokeWidth="1.5" />
    <path d="M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0z" fill="#e95420" />
  </svg>
);
const DockerLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="M4 11h3v3H4zM8 11h3v3H8zM12 11h3v3h-3zM8 7h3v3H8zM12 7h3v3h-3zM12 3h3v3h-3zM16 11h3v3h-3z"
      fill="#2496ed"
    />
    <path
      d="M2 15c2 3 7 3 10 2 4-1 5-4 5-5 1 .5 2 .3 3-.5"
      stroke="#2496ed"
      strokeWidth="1.4"
      fill="none"
    />
  </svg>
);

/** The four styled OS download buttons (Windows / macOS / Linux / Docker). */
function NodeClients() {
  const btns = [
    {
      label: 'Windows',
      sub: '.ps1 installer',
      accent: '#00adef',
      icon: <WindowsLogo />,
      onClick: () => download('install-web3-node.ps1', INSTALL_PS1),
    },
    {
      label: 'macOS',
      sub: '.command installer',
      accent: '#a0a0a0',
      icon: <AppleLogo />,
      onClick: () => download('install-web3-node.command', INSTALL_SCRIPT),
    },
    {
      label: 'Ubuntu',
      sub: '.sh · Linux',
      accent: '#e95420',
      icon: <UbuntuLogo />,
      onClick: () => download('install-web3-node.sh', INSTALL_SCRIPT),
    },
    {
      label: 'Docker',
      sub: 'server · source',
      accent: '#2496ed',
      icon: <DockerLogo />,
      href: REPO,
    },
  ];
  return (
    <div className="dl-panel">
      <p className="dl-head">Download node client</p>
      <div className="dl-grid">
        {btns.map((b) =>
          b.href ? (
            <a
              key={b.label}
              className="dl-btn"
              href={b.href}
              target="_blank"
              rel="noreferrer"
              style={{ ['--accent' as string]: b.accent }}
            >
              <span style={{ flexShrink: 0 }}>{b.icon}</span>
              <div className="dl-txt">
                <div className="dl-lab">{b.label}</div>
                <div className="dl-sub">{b.sub}</div>
              </div>
              <span className="dl-arrow">
                <ArrowDown />
              </span>
            </a>
          ) : (
            <button
              type="button"
              key={b.label}
              className="dl-btn"
              onClick={b.onClick}
              style={{ ['--accent' as string]: b.accent }}
            >
              <span style={{ flexShrink: 0 }}>{b.icon}</span>
              <div className="dl-txt">
                <div className="dl-lab">{b.label}</div>
                <div className="dl-sub">{b.sub}</div>
              </div>
              <span className="dl-arrow">
                <ArrowDown />
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}

const W3Logo = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="1.5" y="1.5" width="21" height="21" rx="5" stroke="currentColor" strokeWidth="1.5" />
    <text
      x="12"
      y="16.5"
      textAnchor="middle"
      fontSize="10"
      fontWeight="700"
      fontFamily="Newsreader, Georgia, serif"
      fill="currentColor"
    >
      W3
    </text>
  </svg>
);

const LinuxLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 2c-2.2 0-3.5 1.8-3.5 4.2 0 1.6.3 2.4-.6 3.7-1 1.4-2.9 3.3-2.9 6 0 1.6.7 2.6 1.6 3.6.5.6.3 1 .9 1.4.6.4 1.6.3 2.3.6.7.3 1.2.6 1.7.6h1c.5 0 1-.3 1.7-.6.7-.3 1.7-.2 2.3-.6.6-.4.4-.8.9-1.4.9-1 1.6-2 1.6-3.6 0-2.7-1.9-4.6-2.9-6-.9-1.3-.6-2.1-.6-3.7C15.5 3.8 14.2 2 12 2z"
      fill="#f2c14e"
      stroke="#0d0d0f"
      strokeWidth="0.8"
    />
    <ellipse cx="10.2" cy="7" rx="1" ry="1.3" fill="#0d0d0f" />
    <ellipse cx="13.8" cy="7" rx="1" ry="1.3" fill="#0d0d0f" />
    <path d="M10.8 9.2 12 10l1.2-.8-1.2-1z" fill="#e95420" />
  </svg>
);

/** The featured one-click desktop app (Windows .exe/.msi, Linux .AppImage/.deb) — no-terminal install. */
function DesktopApp() {
  const btns = [
    {
      label: 'Windows installer',
      sub: `.exe · v${DESKTOP_VERSION}`,
      accent: '#00adef',
      icon: <WindowsLogo />,
      href: DESKTOP_EXE,
    },
    {
      label: 'Windows (MSI)',
      sub: `.msi · v${DESKTOP_VERSION}`,
      accent: '#7c5cff',
      icon: <WindowsLogo />,
      href: DESKTOP_MSI,
    },
    {
      label: 'macOS (.dmg)',
      sub: 'Apple Silicon + Intel',
      accent: '#a0a0a0',
      icon: <AppleLogo />,
      href: DESKTOP_DMG,
    },
    {
      label: 'Linux (AppImage)',
      sub: 'any distro · double-click',
      accent: '#f2c14e',
      icon: <LinuxLogo />,
      href: DESKTOP_APPIMAGE,
    },
    {
      label: 'Linux (.deb)',
      sub: 'Debian · Ubuntu',
      accent: '#e95420',
      icon: <UbuntuLogo />,
      href: DESKTOP_DEB,
    },
    {
      label: 'All releases',
      sub: 'changelog · checksums',
      accent: '#a0a0a0',
      icon: <W3Logo />,
      href: DESKTOP_RELEASE,
    },
  ];
  return (
    <div className="dl-panel">
      <p className="dl-head">
        Desktop app <span className="muted">— one double-click, no terminal</span>
      </p>
      <div className="dl-grid">
        {btns.map((b) => (
          <a
            key={b.label}
            className="dl-btn"
            href={b.href}
            target="_blank"
            rel="noreferrer"
            style={{ ['--accent' as string]: b.accent }}
          >
            <span style={{ flexShrink: 0 }}>{b.icon}</span>
            <div className="dl-txt">
              <div className="dl-lab">{b.label}</div>
              <div className="dl-sub">{b.sub}</div>
            </div>
            <span className="dl-arrow">
              <ArrowDown />
            </span>
          </a>
        ))}
      </div>
      <p className="dl-blurb">
        Installs as <b>Web3.0</b> (W3 icon) — launch it and it boots a node and opens this dashboard
        in one window. No Node.js, pnpm, or terminal. The build is unsigned, so the first launch
        needs one extra click:
      </p>
      <div className="dl-notes">
        <div className="dl-note">
          <span className="dl-note-os">Windows</span>
          <span>
            SmartScreen shows “unknown publisher” → <b>More info → Run anyway</b>
          </span>
        </div>
        <div className="dl-note">
          <span className="dl-note-os">macOS</span>
          <span>
            right-click the app → <b>Open</b> · or <code>xattr -cr /Applications/Web3.0.app</code>
          </span>
        </div>
        <div className="dl-note">
          <span className="dl-note-os">Linux</span>
          <span>
            <code>chmod +x</code> the AppImage · or <code>sudo apt install ./web3_*.deb</code>
          </span>
        </div>
        <div className="dl-note">
          <span className="dl-note-os">Data</span>
          <span>
            runs in-memory by default — set <code>WEB3_MONGODB_URI</code> to persist
          </span>
        </div>
      </div>
    </div>
  );
}

function Card({ p }: { p: Platform }) {
  return (
    <div>
      <div className="term">
        <div className="term-bar">
          <div className="term-dot" style={{ background: '#ff5f57' }} />
          <div className="term-dot" style={{ background: '#ffbd2e' }} />
          <div className="term-dot" style={{ background: '#28c840' }} />
          <span className="term-name">
            {p.name} · {p.tag}
          </span>
        </div>
        <div className="term-body">
          <pre className="term-steps">
            <code>{p.steps}</code>
          </pre>
        </div>
      </div>
      {p.note && <p className="hint">{p.note}</p>}
    </div>
  );
}

export function Download() {
  return (
    <>
      <div className="page-head">
        <h1>Run a node</h1>
        <span className="muted">
          download the node and join Web3.0 from any device — earn aETH hosting it
        </span>
      </div>

      <DesktopApp />
      <div style={{ height: 18 }} />
      <NodeClients />
      <div style={{ height: 18 }} />
      <NodeTerminal />

      <p className="hint" style={{ margin: '14px 2px 0' }}>
        Steps: clone → activate a Python venv → install packages (pnpm) → install the agent SDK
        (pip) → start the node. The one-click installers do this for you and also{' '}
        <b>set up Node.js 20+ and git</b> if missing. On <b>Windows</b>, activate the venv with{' '}
        <code>.venv\Scripts\activate</code> (not <code>source</code>) and run the <code>.ps1</code>{' '}
        via right-click → Run with PowerShell.
      </p>

      <div className="section-title" style={{ margin: '22px 0 10px' }}>
        All platforms &amp; manual setup
      </div>

      <div className="grid-2">
        {PLATFORMS.map((p) => (
          <Card p={p} key={p.name} />
        ))}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-title">After it starts</div>
        <ol className="steps">
          <li>
            The node comes up on <code>http://127.0.0.1:8787</code> — open <code>/health</code> to
            check.
          </li>
          <li>
            To join a shared chain, set <code>WEB3_CONSENSUS=poa</code>,{' '}
            <code>WEB3_AUTHORITIES</code>, and <code>WEB3_PEERS</code> in <code>.env</code>.
          </li>
          <li>
            To earn, set <code>WEB3_FEE_BPS</code> and/or <code>WEB3_BLOCK_REWARD</code> — earnings
            land in <code>treasury@web3.0</code>, visible in the dashboard.
          </li>
        </ol>
      </div>
    </>
  );
}
