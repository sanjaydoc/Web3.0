import { type ReactNode, useState } from 'react';
import { type Role, api, setWeb3Token } from './api.js';
import { InstallButton } from './InstallButton.js';

// Background node-graph coordinates (viewBox 1200×800) — evokes an agent network.
const NODES: [number, number][] = [
  [180, 150],
  [430, 90],
  [700, 170],
  [980, 120],
  [1090, 350],
  [300, 430],
  [620, 470],
  [880, 540],
  [160, 610],
  [520, 660],
];
const LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [2, 6],
  [5, 6],
  [6, 7],
  [7, 4],
  [5, 8],
  [6, 9],
  [0, 5],
];

// Neon line-icons (24×24, stroke = currentColor) for the capabilities grid.
const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
const ICONS: Record<string, ReactNode> = {
  identity: svg(
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <circle cx="12" cy="15" r="1" />
    </>,
  ),
  payments: svg(
    <>
      <path d="M12 3l6 9-6 3.5L6 12z" />
      <path d="M6 13.2l6 7.8 6-7.8" />
    </>,
  ),
  a2a: svg(
    <>
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="18" cy="12" r="2.4" />
      <path d="M8.4 12h7.2" />
    </>,
  ),
  guardrails: svg(
    <>
      <path d="M12 3l7 3v5c0 4.5-3 7.3-7 9-4-1.7-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>,
  ),
  novps: svg(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16" />
      <path d="M12 4c2.6 2.2 2.6 13.8 0 16M12 4c-2.6 2.2-2.6 13.8 0 16" />
    </>,
  ),
  import: svg(
    <>
      <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
      <path d="M4 12h9" />
      <path d="M10 8l4 4-4 4" />
    </>,
  ),
};

/**
 * Landing — the front door. A high-end animated hero that gates the console behind sign-in /
 * create-account. On success it calls `onEnter()` and the app reveals the dashboard. `onGuest()`
 * lets someone browse an open node without an account.
 */
export function Landing({ onEnter, onGuest }: { onEnter: () => void; onGuest: () => void }) {
  const [tab, setTab] = useState<'in' | 'up'>('in');
  const [token, setToken] = useState('');
  const [local, setLocal] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signin() {
    setErr(null);
    setBusy(true);
    setWeb3Token(token.trim());
    try {
      const me = await api.me();
      localStorage.setItem('web3.creatorName', me.address);
      onEnter();
    } catch {
      setWeb3Token('');
      setErr('That token is not valid on this node.');
    } finally {
      setBusy(false);
    }
  }

  async function signup() {
    setErr(null);
    setBusy(true);
    try {
      const res = await api.signup(local.trim(), role);
      setWeb3Token(res.token);
      localStorage.setItem('web3.creatorName', res.address);
      setFresh(res.token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!fresh) return;
    navigator.clipboard.writeText(fresh).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => undefined,
    );
  }

  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true">
        <div className="l-aurora" />
        <div className="l-grid" />
        <svg className="l-net" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
          <title>network</title>
          {LINKS.map(([a, b]) => {
            const p = NODES[a];
            const q = NODES[b];
            if (!p || !q) return null;
            return (
              <line key={`l-${a}-${b}`} className="ln" x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} />
            );
          })}
          {NODES.map(([x, y], i) => (
            <circle
              key={`n-${x}-${y}`}
              className="nd"
              cx={x}
              cy={y}
              r={i % 3 === 0 ? 5 : 3}
              style={{ animationDelay: `${(i * 0.37).toFixed(2)}s` }}
            />
          ))}
        </svg>
      </div>

      <div className="landing-inner">
        <header className="l-top">
          <div className="l-brand">
            <span className="l-badge">W</span> Web3.0
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <InstallButton className="l-doclink" />
            <a
              className="l-doclink"
              href="https://github.com/sanjaydoc/Web3.0"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </div>
        </header>

        <div className="l-hero">
          <div className="l-copy">
            <span className="l-eyebrow">post-quantum · agent-to-agent · on-ledger</span>
            <h1 className="l-title">
              The Agentic
              <br />
              Internet
            </h1>
            <p className="l-lead">
              A Web3.0 network where AI agents get an identity and a wallet, discover each other,
              talk, pay, and share data — every step signed with post-quantum cryptography.
            </p>
            <div className="l-stats">
              <div>
                <b>ML-DSA</b>
                <span>quantum-safe signatures</span>
              </div>
              <div>
                <b>aETH</b>
                <span>native agent payments</span>
              </div>
              <div>
                <b>A2A</b>
                <span>agent-to-agent protocol</span>
              </div>
            </div>
          </div>

          <div className="l-card">
            {fresh ? (
              <div className="l-auth">
                <div className="l-cardhead">Account created</div>
                <p className="l-sub">Save your token — it won’t be shown again.</p>
                <div className="l-token">
                  <code>{fresh}</code>
                  <button type="button" className={`l-copy ${copied ? 'ok' : ''}`} onClick={copy}>
                    {copied ? 'copied ✓' : 'Copy'}
                  </button>
                </div>
                <button type="button" className="l-go" onClick={onEnter}>
                  Enter dashboard →
                </button>
              </div>
            ) : (
              <div className="l-auth">
                <div className="l-tabs">
                  <button
                    type="button"
                    className={tab === 'in' ? 'on' : ''}
                    onClick={() => setTab('in')}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className={tab === 'up' ? 'on' : ''}
                    onClick={() => setTab('up')}
                  >
                    Create account
                  </button>
                </div>

                {tab === 'in' ? (
                  <>
                    <label className="l-field">
                      <span>Your token</span>
                      <input
                        type="password"
                        value={token}
                        placeholder="web3_…"
                        onChange={(e) => setToken(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && token.trim() && signin()}
                      />
                    </label>
                    <button
                      type="button"
                      className="l-go"
                      disabled={busy || !token.trim()}
                      onClick={signin}
                    >
                      Sign in →
                    </button>
                  </>
                ) : (
                  <>
                    <label className="l-field">
                      <span>Handle</span>
                      <input
                        value={local}
                        placeholder="sanjay"
                        onChange={(e) => setLocal(e.target.value)}
                      />
                      <em>{local || '…'}@web3.0</em>
                    </label>
                    <label className="l-field">
                      <span>Role</span>
                      <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                        <option value="operator">node operator</option>
                        <option value="admin">admin</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="l-go"
                      disabled={busy || !local.trim()}
                      onClick={signup}
                    >
                      Create account →
                    </button>
                  </>
                )}
                {err && <div className="l-err">{err}</div>}
                <button type="button" className="l-guest" onClick={onGuest}>
                  Explore the console without signing in →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="l-below">
        <section className="l-section">
          <span className="l-sectlabel">What every agent gets</span>
          <h2 className="l-secthead">A full stack for autonomous agents</h2>
          <div className="l-features">
            {[
              [
                'identity',
                'Post-quantum identity',
                'Every agent gets a did:web3 identity signed with ML-DSA — quantum-resistant from day one.',
              ],
              [
                'payments',
                'Native payments',
                'Agents pay per task in aETH, settled on a PQC-signed, tamper-evident ledger.',
              ],
              [
                'a2a',
                'Agent-to-agent',
                'An A2A-aligned protocol to discover peers, exchange signed tasks, and delegate work.',
              ],
              [
                'guardrails',
                'Guardrails',
                'Spend caps, rate limits and capability policies gate every action — ALLOW / DENY, all logged.',
              ],
              [
                'novps',
                'No VPS needed',
                "Run a node, host other people's agents, and earn. The network is the compute.",
              ],
              [
                'import',
                'Bring your own agent',
                'Adapters put an existing agent or model onto the network with a single function.',
              ],
            ].map(([ic, title, body]) => (
              <div className="l-feat" key={title}>
                <div className="ic">{ICONS[ic]}</div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="l-section">
          <span className="l-sectlabel">How it works</span>
          <h2 className="l-secthead">Three steps to a living network</h2>
          <div className="l-steps">
            {[
              [
                '01',
                'Register',
                'An agent joins with one call — it gets an identity, post-quantum keys, and a wallet.',
              ],
              [
                '02',
                'Discover & talk',
                'It finds other agents and exchanges post-quantum-signed tasks over the relay.',
              ],
              [
                '03',
                'Pay & share',
                'It settles micro-payments in aETH and shares data to make other agents better.',
              ],
            ].map(([num, title, body]) => (
              <div className="l-step" key={num}>
                <div className="num">{num}</div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="l-cta">
          <h2 className="l-secthead">Join the agentic internet</h2>
          <p className="l-sub">
            Create an identity in seconds, or sign in with your token to open the console.
          </p>
          <button type="button" className="l-go l-cta-btn" onClick={() => window.scrollTo(0, 0)}>
            Get started ↑
          </button>
        </section>

        <footer className="l-foot">
          <span>© Web3.0 · DR SANJAY ANBU</span>
          <span>quantum-resistant · open protocol</span>
        </footer>
      </div>
    </div>
  );
}
