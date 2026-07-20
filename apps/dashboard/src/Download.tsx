import { useState } from 'react';

// The PUBLIC repo — the open console + Python agent SDK + docs. The node's server core (registry,
// relay, ledger, consensus) is closed-source and ships *inside* the desktop app below; there is no
// public "run the node from source" path, so this page centers the installers for that.
const REPO = 'https://github.com/sanjaydoc/Web3.0';

// The packaged desktop app (Electron) — runs a full node + opens the dashboard in one window.
// Published by the `desktop` workflow on every version tag, attached to the public repo's releases.
const DESKTOP_VERSION = '0.1.0';
const DESKTOP_RELEASE = `${REPO}/releases/latest`;
const DL = `${REPO}/releases/download/v${DESKTOP_VERSION}`;
const DESKTOP_EXE = `${DL}/Web3.0.Setup.${DESKTOP_VERSION}.exe`;
const DESKTOP_MSI = `${DL}/Web3.0.${DESKTOP_VERSION}.msi`;
const DESKTOP_DMG = `${DL}/Web3.0-${DESKTOP_VERSION}-universal.dmg`;
const DESKTOP_APPIMAGE = `${DL}/Web3.0-${DESKTOP_VERSION}.AppImage`;
const DESKTOP_DEB = `${DL}/web3_${DESKTOP_VERSION}_amd64.deb`;

// Commands that actually work against the PUBLIC repo: run the open console, or build an agent with
// the SDK. (Running the node itself is the desktop app above — its core isn't in this repo.)
const CLIENT_CMDS = [
  `git clone ${REPO}.git && cd Web3.0`,
  'pnpm install',
  'pnpm --filter @web3/dashboard dev', // the console → http://localhost:5173
  'pip install -e packages/web3-sdk-py', // the Python agent SDK
];

const ArrowDown = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);
const CopyIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const CheckIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
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

const WindowsLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M3 5.5L11 4v8H3V5.5zM13 4l8 1.5V12h-8V4zM3 13h8v7.5L3 19V13zM13 13h8v6l-8 1.5V13z"
      fill="#00adef"
    />
  </svg>
);
const AppleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
      fill="#ccc"
    />
  </svg>
);
const UbuntuLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="#e95420" strokeWidth="1.5" />
    <path d="M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0z" fill="#e95420" />
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

/** The featured one-click desktop app — the only setup-free way to run a node (it bundles one). */
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
        Installs as <b>Web3.0</b> (W3 icon). Launch it and it boots a full node — registry, relay,
        payments, ledger, consensus — and opens this dashboard in one window. No Node.js, pnpm, or
        terminal. The build is unsigned, so the first launch needs one extra click:
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

/** The open-source client terminal: clone the PUBLIC repo to run the console or build an agent. */
function ClientTerminal() {
  return (
    <div className="term">
      <div className="term-bar">
        <div className="term-dot" style={{ background: '#ff5f57' }} />
        <div className="term-dot" style={{ background: '#ffbd2e' }} />
        <div className="term-dot" style={{ background: '#28c840' }} />
        <span className="term-name">web3.0 — open client</span>
      </div>
      <div className="term-body">
        {CLIENT_CMDS.map((c) => (
          <CmdLine key={c} command={c} />
        ))}
        <div className="term-out">
          <div>
            <span className="tl-cyan">⟳ Building the console (Vite)…</span>
          </div>
          <div>
            <span className="tl-out">&nbsp;&nbsp;✓ console on http://localhost:5173</span>
          </div>
          <div>
            <span className="tl-gold">⟳ Installing the Python agent SDK (ML-DSA signing)…</span>
          </div>
          <div>
            <span className="tl-out">&nbsp;&nbsp;✓ web3_sdk ready — point it at any node</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Download() {
  return (
    <>
      <div className="page-head">
        <h1>Run a node</h1>
        <span className="muted">
          download the app for your device and join Web3.0 — earn aETH hosting it
        </span>
      </div>

      <DesktopApp />

      <p className="hint" style={{ margin: '14px 2px 0' }}>
        <b>The desktop app is the node.</b> It bundles the server core (registry · relay · ledger ·
        consensus) and this dashboard into one installer — nothing to clone, no runtime to set up.
        To run a node, download it above; to point it at a shared chain or persist data, set the
        environment variables below.
      </p>

      <div className="section-title" style={{ margin: '22px 0 10px' }}>
        Build on Web3.0 <span className="muted">— open source</span>
      </div>
      <p className="hint" style={{ margin: '0 2px 12px' }}>
        The <b>console</b> and the <b>Python agent SDK</b> are open. Clone the public repo to hack
        on the dashboard or build an agent, then point either at any running node (set{' '}
        <code>VITE_WEB3_URL</code> for the console, or pass <code>node=…</code> to the SDK).
      </p>
      <ClientTerminal />

      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-title">Configure your node</div>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          The desktop app reads these environment variables at launch (set them in your OS, or in
          the app's config file).
        </p>
        <ol className="steps">
          <li>
            The node comes up on <code>http://127.0.0.1:8787</code> — open <code>/health</code> to
            check.
          </li>
          <li>
            To join a shared chain, set <code>WEB3_CONSENSUS=poa</code>,{' '}
            <code>WEB3_AUTHORITIES</code>, and <code>WEB3_PEERS</code>.
          </li>
          <li>
            To earn, set <code>WEB3_FEE_BPS</code> and/or <code>WEB3_BLOCK_REWARD</code> — earnings
            land in <code>treasury@web3.0</code>, visible in the dashboard.
          </li>
          <li>
            To persist across restarts, set <code>WEB3_MONGODB_URI</code> (MongoDB Atlas) —
            otherwise the node runs in-memory.
          </li>
        </ol>
      </div>
    </>
  );
}
