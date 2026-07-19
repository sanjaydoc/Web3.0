const REPO = 'https://github.com/sanjaydoc/Web3.0';

const INSTALL_SCRIPT = `#!/usr/bin/env bash
# Run an ACP (Web3.0) node on macOS or Linux.
# Installs Node.js 20+ and git automatically if they're missing.
set -euo pipefail
REPO="\${ACP_REPO:-${REPO}.git}"
DIR="\${ACP_DIR:-acp-node}"

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
[ "\${NODE_MAJOR:-0}" -ge 20 ] || echo "⚠ Node \${NODE_MAJOR} found; ACP wants 20+. If it errors, upgrade via nvm: https://github.com/nvm-sh/nvm"

[ -d "$DIR" ] || git clone --depth 1 "$REPO" "$DIR"
cd "$DIR"
corepack enable >/dev/null 2>&1 || npm install -g pnpm
pnpm install
[ -f .env ] || cp .env.example .env
pnpm --filter @acp/node start
`;

const INSTALL_PS1 = `# Run an ACP (Web3.0) node on Windows (PowerShell).
# Installs Node.js 20+ and git automatically (via winget) if they're missing.
# Usage:  powershell -ExecutionPolicy Bypass -File install-acp-node.ps1
$ErrorActionPreference = "Stop"
$Repo = if ($env:ACP_REPO) { $env:ACP_REPO } else { "${REPO}.git" }
$Dir  = if ($env:ACP_DIR)  { $env:ACP_DIR }  else { "acp-node" }
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
pnpm --filter '@acp/node' start
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
pnpm --filter @acp/node start`,
    note: 'The one-click installers above set up Node.js 20+ and git for you. The dashboard runs with `pnpm --filter @acp/dashboard dev`.',
  },
  {
    name: 'Server',
    tag: 'Docker',
    steps: `git clone ${REPO}.git && cd Web3.0
docker build -t acp-node .
docker run -p 8787:8787 --env-file .env acp-node`,
    note: 'Point ACP_MONGODB_URI at Atlas to persist. Put it behind a reverse proxy for TLS.',
  },
  {
    name: 'Android phone · tablet',
    tag: 'Termux',
    steps: `pkg install nodejs git
git clone ${REPO}.git && cd Web3.0
npm install -g pnpm && pnpm install
pnpm --filter @acp/node start`,
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

function Card({ p }: { p: Platform }) {
  return (
    <div className="card">
      <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{p.name}</span>
        <span className="chip">{p.tag}</span>
      </div>
      <pre>
        <code>{p.steps}</code>
      </pre>
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

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">One-click installer</div>
        <p className="muted" style={{ margin: '2px 0 12px' }}>
          Grab the installer for your OS — it <b>installs Node.js 20+ and git for you</b> if they're
          missing, then clones the repo, installs dependencies, and starts the node. Nothing to set
          up first. Review it, then run it (details below each button).
        </p>
        <div className="gen-actions">
          <button
            type="button"
            className="btn act"
            onClick={() => download('install-acp-node.ps1', INSTALL_PS1)}
          >
            ⊞ Windows installer
          </button>
          <button
            type="button"
            className="btn act"
            onClick={() => download('install-acp-node.command', INSTALL_SCRIPT)}
          >
            🍎 Mac installer
          </button>
          <button
            type="button"
            className="btn act"
            onClick={() => download('install-acp-node.sh', INSTALL_SCRIPT)}
          >
            🐧 Linux installer
          </button>
          <a className="btn" href={REPO} target="_blank" rel="noreferrer">
            View source on GitHub
          </a>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          <b>Windows:</b> right-click the <code>.ps1</code> → Run with PowerShell, or{' '}
          <code>powershell -ExecutionPolicy Bypass -File install-acp-node.ps1</code>. &nbsp;
          <b>Mac/Linux:</b> <code>chmod +x install-acp-node.* &amp;&amp; ./install-acp-node.*</code>{' '}
          (or one-line: <code>curl -fsSL {REPO}/raw/main/scripts/install-node.sh | bash</code>).
        </p>
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
            To join a shared chain, set <code>ACP_CONSENSUS=poa</code>, <code>ACP_AUTHORITIES</code>
            , and <code>ACP_PEERS</code> in <code>.env</code>.
          </li>
          <li>
            To earn, set <code>ACP_FEE_BPS</code> and/or <code>ACP_BLOCK_REWARD</code> — earnings
            land in <code>treasury@web3.0</code>, visible in the dashboard.
          </li>
        </ol>
      </div>
    </>
  );
}
