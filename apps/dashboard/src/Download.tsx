const REPO = 'https://github.com/sanjaydoc/Web3.0';

const INSTALL_SCRIPT = `#!/usr/bin/env bash
# Run an ACP (Web3.0) node on any machine.
set -euo pipefail
REPO="\${ACP_REPO:-${REPO}.git}"
DIR="\${ACP_DIR:-acp-node}"
command -v git  >/dev/null || { echo "git required"; exit 1; }
command -v node >/dev/null || { echo "Node.js 20+ required — https://nodejs.org"; exit 1; }
[ -d "$DIR" ] || git clone --depth 1 "$REPO" "$DIR"
cd "$DIR"
corepack enable >/dev/null 2>&1 || npm install -g pnpm
pnpm install
[ -f .env ] || cp .env.example .env
pnpm --filter @acp/node start
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
    steps: `git clone ${REPO}.git
cd Web3.0
pnpm install        # or: npm install -g pnpm && pnpm install
cp .env.example .env
pnpm --filter @acp/node start`,
    note: 'Needs Node.js 20+ and git. The dashboard runs with `pnpm --filter @acp/dashboard dev`.',
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
        <div className="section-title">One-line install</div>
        <p className="muted" style={{ margin: '2px 0 12px' }}>
          Fastest path on Mac, Linux, or Android/Termux — clones the repo, installs, and starts the
          node. Review it first; then run it in a terminal.
        </p>
        <pre>
          <code>curl -fsSL {REPO}/raw/main/scripts/install-node.sh | bash</code>
        </pre>
        <div className="gen-actions">
          <button
            type="button"
            className="btn act"
            onClick={() => download('install-acp-node.sh', INSTALL_SCRIPT)}
          >
            Download install script
          </button>
          <a className="btn" href={REPO} target="_blank" rel="noreferrer">
            View source on GitHub
          </a>
        </div>
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
