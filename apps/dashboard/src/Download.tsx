import { useState } from 'react';

// The PUBLIC repo — the open console + Python agent SDK + docs. The node's server core (registry,
// relay, ledger, consensus) is closed-source and runs on the canonical shared-network node; the
// desktop app below is a native client for it, so this page centers those installers.
const REPO = 'https://github.com/sanjaydoc/Web3.0';

// The packaged desktop app (Electron) — runs a real Web3.0 peer node and opens this console against
// it. The node joins the ONE shared chain (replicates, relays, forwards signed txs); every install
// is a first-class participant. Published by the `desktop` workflow on every version tag, to the
// public repo's releases.
// DESKTOP_VERSION = the release tag (shown to users + the /releases/download/v… path). DESKTOP_FILE =
// the installer file version (electron-builder names files from desktop/package.json); can differ.
const DESKTOP_VERSION = '0.1.38';
const DESKTOP_FILE = '0.1.38';
const DESKTOP_RELEASE = `${REPO}/releases/latest`;
const DL = `${REPO}/releases/download/v${DESKTOP_VERSION}`;
const DESKTOP_EXE = `${DL}/Web3.0.Setup.${DESKTOP_FILE}.exe`;
const DESKTOP_MSI = `${DL}/Web3.0.${DESKTOP_FILE}.msi`;
const DESKTOP_DMG = `${DL}/Web3.0-${DESKTOP_FILE}-universal.dmg`;
const DESKTOP_APPIMAGE = `${DL}/Web3.0-${DESKTOP_FILE}.AppImage`;
const DESKTOP_DEB = `${DL}/web3_${DESKTOP_FILE}_amd64.deb`;

// The Android app — a REAL peer node on the phone (nodejs-mobile) that joins the same shared chain.
// Published by the `android` workflow to a rolling `android` pre-release, so this link always points
// at the latest build. Unsigned debug APK → sideload (enable "Install unknown apps").
const ANDROID_APK = `${REPO}/releases/download/android/Web3.0-android.apk`;

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

/** The featured one-click desktop app — a native client for the shared Web3.0 network. */
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
        Installs as <b>Web3.0</b> (W3 icon). Launch it and it opens this console as a native app,
        connected to the <b>shared Web3.0 network</b> — same accounts, agents, and ledger as
        everyone else. Nothing to configure, no database to run: sign in and you're on the network.
        The build is unsigned, so the first launch needs one extra click:
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

const AndroidLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M6 9h12v8a1 1 0 0 1-1 1h-1v3a1 1 0 0 1-2 0v-3h-2v3a1 1 0 0 1-2 0v-3H9a1 1 0 0 1-1-1V9zM4 9a1 1 0 0 1 2 0v6a1 1 0 0 1-2 0V9zm14 0a1 1 0 0 1 2 0v6a1 1 0 0 1-2 0V9zM7.5 8a4.5 4.5 0 0 1 9 0h-9z"
      fill="#3ddc84"
    />
    <circle cx="10" cy="5.5" r="0.7" fill="#0d0d0f" />
    <circle cx="14" cy="5.5" r="0.7" fill="#0d0d0f" />
  </svg>
);

/** Mobile apps. Android ships now as a downloadable APK that runs a REAL peer node on the phone
 *  (nodejs-mobile). iOS is still to come — a wallet + light client, since iOS suspends background
 *  apps so it can't be an always-on node. */
function MobileApps() {
  return (
    <div className="dl-panel" style={{ marginTop: 16 }}>
      <p className="dl-head">
        Mobile <span className="muted">— Android available now</span>
      </p>
      <div className="store-badges">
        <a className="store-badge" href={ANDROID_APK} target="_blank" rel="noreferrer">
          <span className="store-badge-icon">
            <AndroidLogo />
          </span>
          <span className="store-badge-txt">
            <span className="store-badge-top">Get it — full node</span>
            <span className="store-badge-big">Android</span>
          </span>
        </a>
        <div className="store-badge is-soon" aria-disabled="true">
          <span className="store-badge-icon">
            <AppleLogo />
          </span>
          <span className="store-badge-txt">
            <span className="store-badge-top">Coming soon</span>
            <span className="store-badge-big">iOS</span>
          </span>
        </div>
      </div>
      <p className="dl-blurb">
        <b>Android</b> runs a <b>real node on your phone</b> — same shared chain as desktop. It's an
        unsigned build, so sideload it: open the <b>.apk</b>, allow <b>“Install unknown apps”</b>{' '}
        for your browser, then launch. First open unpacks the node and drops you into the same{' '}
        <b>“Run a node — quick setup”</b> onboarding. <b>iOS</b> comes later via the App Store /
        TestFlight (no iOS “APK”); because iOS suspends background apps, it acts as a{' '}
        <b>wallet and light client</b> rather than an always-on node.
      </p>
    </div>
  );
}

/** Honest capability tiers so no one expects a browser tab to earn like a desktop node. */
function PlatformTable() {
  const rows: [string, string, string][] = [
    ['Desktop (Win/mac/Linux)', 'Full node — best earner', 'Available now'],
    ['Android', 'Full node on the phone (nodejs-mobile)', 'Available now'],
    ['iOS', 'Wallet + light client (background-limited)', 'Coming soon'],
    ['Browser (any device)', 'Light client — sign in & explore, no earning', 'Available now'],
  ];
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="section-title">What each platform can do</div>
      {/* Scroll wrapper: three columns + the nowrap status pill can exceed a phone's width, and
          without this the table (and the "Available now" pill) bleeds out past the card's right
          edge. Here it scrolls inside the card instead. */}
      <div className="hscroll">
        <table>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Node capability</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([p, cap, status]) => (
              <tr key={p}>
                <td>
                  <strong>{p}</strong>
                </td>
                <td>{cap}</td>
                <td>
                  <span className={`chip ${status === 'Available now' ? 'allow' : ''}`}>
                    {status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ margin: '10px 0 0' }}>
        Earning scales with what you actually contribute: an always-on desktop node earns most; a
        phone contributes when the app is running; a browser tab is an on-ramp, not an earner.
      </p>
    </div>
  );
}

export function Download({ onGetStarted }: { onGetStarted?: () => void }) {
  return (
    <>
      <div className="page-head">
        <h1>Run a node</h1>
        <span className="muted">
          run a Web3.0 node on your device to join the network and earn USDC for the compute you
          contribute
        </span>
      </div>

      {/* Guided first-run setup — name, node location, and RAM to contribute — for operators on
          their own node. Only wired in when onboarding applies (never on the reserved main node). */}
      {onGetStarted && (
        <div
          className="card"
          style={{
            marginBottom: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="section-title">New here? Get set up in a minute</div>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              Pick a name, put your node on the map, and choose how much RAM to contribute.
            </p>
          </div>
          <button type="button" className="btn act" onClick={onGetStarted}>
            Get started →
          </button>
        </div>
      )}

      <DesktopApp />

      <p className="hint" style={{ margin: '14px 2px 0' }}>
        <b>A real peer node — one shared network.</b> The desktop app runs a full Web3.0 node that
        joins the shared chain: it replicates the whole ledger, relays gossip to other peers, and
        forwards your account-signed transactions to be sealed. Same chain, accounts, and ledger as
        everyone else — you're a first-class participant, not an island. Just install and sign in.
      </p>

      <MobileApps />

      <PlatformTable />

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
        <div className="section-title">You're running a node on the shared network</div>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          The app starts a Web3.0 peer node on your machine and opens this console against it. The
          node syncs the full chain from the network's authority, relays gossip, and forwards the
          transactions you sign here — there's nothing to configure and no database to run.
        </p>
        <p className="hint" style={{ margin: 0 }}>
          Your payments are signed on this device with your account key (ML-DSA) and sealed by an
          authority. Want to become an authority yourself and produce blocks? Stake USDC from{' '}
          <b>My node</b> — the network seats you automatically.
        </p>
      </div>
    </>
  );
}
