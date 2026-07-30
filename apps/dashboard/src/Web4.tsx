import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Erc8004Identity,
  type Erc8004Reputation,
  type Erc8004Root,
  NODE_URL,
  type SettlementInfo,
  type X402Info,
  type X402Receipt,
  type X402Service,
  type X402Supported,
  api,
} from './api.js';

/** Format atomic USDC (6dp) as `$x.xx`. */
function usdc(atomic: string | number): string {
  let v: bigint;
  try {
    v = BigInt(atomic);
  } catch {
    return '$0.00';
  }
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `$${whole.toString()}.${frac}`;
}

const short = (s: string, head = 6, tail = 4) =>
  s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;

/** A 0–100 reputation meter with a score-graded colour. */
function Meter({ score }: { score: number }) {
  const color = score >= 75 ? 'var(--ok, #1f9d55)' : score >= 40 ? '#c98a00' : 'var(--no, #c0392b)';
  return (
    <div className="rep-meter" title={`${score}/100`}>
      <div
        className="rep-meter-fill"
        style={{ width: `${Math.max(2, score)}%`, background: color }}
      />
      <span className="rep-meter-label">{score}</span>
    </div>
  );
}

interface AgentRep {
  agent: Erc8004Identity;
  rep?: Erc8004Reputation;
}

/** A code block with a one-click copy button. */
function CopyBlock({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="copy-block">
      <button type="button" className="btn btn-sm copy-btn" onClick={copy}>
        {copied ? 'Copied ✓' : label}
      </button>
      <pre className="copy-pre">
        <code>{text}</code>
      </pre>
    </div>
  );
}

/**
 * OxygenPanel — connect the Oxygen MCP wallet to Claude Code. Emits a ready-to-save `.mcp.json`
 * (platform-aware, since the launch command differs on Windows) with a copy button.
 */
function OxygenPanel() {
  const [platform, setPlatform] = useState<'unix' | 'windows'>(() =>
    typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent) ? 'windows' : 'unix',
  );
  const cwd = platform === 'windows' ? 'C:\\path\\to\\Web3.0' : '/path/to/Web3.0';
  const server =
    platform === 'windows'
      ? {
          command: 'cmd',
          args: ['/c', 'pnpm', '--filter', '@web3/oxygen-mcp', 'exec', 'tsx', 'src/index.ts'],
        }
      : { command: 'pnpm', args: ['--filter', '@web3/oxygen-mcp', 'exec', 'tsx', 'src/index.ts'] };
  const json = JSON.stringify(
    { mcpServers: { 'oxygen-mcp': { ...server, cwd, env: { OXYGEN_START_USDC: '50000000' } } } },
    null,
    2,
  );
  // The `claude mcp add` one-liner — the least-manual path: paste in a terminal (with cwd = repo)
  // and Claude Code registers Oxygen for you, no file editing.
  const cli =
    platform === 'windows'
      ? 'claude mcp add oxygen-mcp -e OXYGEN_START_USDC=50000000 -- cmd /c pnpm --filter @web3/oxygen-mcp exec tsx src/index.ts'
      : 'claude mcp add oxygen-mcp -e OXYGEN_START_USDC=50000000 -- pnpm --filter @web3/oxygen-mcp exec tsx src/index.ts';

  const [copiedCli, setCopiedCli] = useState(false);
  const connect = async () => {
    try {
      await navigator.clipboard.writeText(cli);
      setCopiedCli(true);
      window.setTimeout(() => setCopiedCli(false), 1800);
    } catch {
      setCopiedCli(false);
    }
  };

  return (
    <div style={{ marginTop: 20, borderTop: '1px solid var(--hair)', paddingTop: 16 }}>
      <div className="section-title" style={{ fontSize: '1rem' }}>
        Your Oxygen wallet · Claude Code
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Oxygen is Web3.0’s x402 wallet for Claude Code. Connect it, then just ask Claude to{' '}
        <i>“check my wallet”</i> or <i>“fetch &lt;url&gt; and pay if it asks”</i>. Save this as{' '}
        <code>.mcp.json</code> in your project (it points Claude at the local Oxygen MCP server).
      </p>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 6,
        }}
      >
        <button type="button" className="btn" onClick={connect}>
          {copiedCli ? 'Command copied ✓ — paste in your terminal' : '⚡ Connect to Claude Code'}
        </button>
        {/* biome-ignore lint/a11y/useSemanticElements: styled div toggle, not a form fieldset */}
        <div className="role-toggle" role="group" aria-label="Platform">
          <button
            type="button"
            className={platform === 'unix' ? 'active' : ''}
            onClick={() => setPlatform('unix')}
          >
            macOS / Linux
          </button>
          <button
            type="button"
            className={platform === 'windows' ? 'active' : ''}
            onClick={() => setPlatform('windows')}
          >
            Windows
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        “Connect” copies a <code>claude mcp add</code> command — run it in a terminal from your repo
        folder and Claude Code registers Oxygen for you (no file editing). A browser can’t install
        it directly, so this is the one-paste path.
      </p>
      <CopyBlock text={cli} label="Copy command" />

      <details style={{ marginTop: 12 }}>
        <summary className="muted" style={{ cursor: 'pointer' }}>
          Prefer a config file? Show <code>.mcp.json</code>
        </summary>
        <div style={{ marginTop: 10 }}>
          <CopyBlock text={json} label="Copy .mcp.json" />
        </div>
      </details>

      <p className="muted" style={{ marginTop: 10 }}>
        Prereq: clone the repo, run <code>pnpm install</code>, and run the command from that folder
        (or set <code>cwd</code>). For a funded wallet, add <code>-e OXYGEN_WALLET_KEY=0x…</code>
        {'; '}left out, it runs in demo mode with a $50 balance. This node is at{' '}
        <span className="mono-hash">{NODE_URL}</span>.
      </p>
    </div>
  );
}

/**
 * Web4 — the two Web 4.0 standards, surfaced per persona:
 *   • x402      → money (agent earnings / node facilitator)
 *   • ERC-8004  → identity & reputation (agent trust / node registry)
 *
 * `scope="agent"` renders the agent-owner view (your agents' earnings + trust, bind a wallet);
 * `scope="node"` renders the node-operator view (facilitator receipts + the ERC-8004 registry).
 */
export function Web4({ scope, me }: { scope: 'agent' | 'node'; me?: string | null }) {
  const [root, setRoot] = useState<Erc8004Root | null>(null);
  const [rows, setRows] = useState<AgentRep[]>([]);
  const [supported, setSupported] = useState<X402Supported | null>(null);
  const [receipts, setReceipts] = useState<X402Receipt[]>([]);
  const [services, setServices] = useState<X402Service[]>([]);
  const [settlement, setSettlement] = useState<SettlementInfo | null>(null);
  const [x402info, setX402info] = useState<X402Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rootRes, agentsRes, supp, rcpts, dir, settle, info] = await Promise.all([
        api.erc8004Root().catch(() => null),
        api
          .erc8004Agents()
          .catch(() => ({ agents: [] as Erc8004Identity[], count: 0, registry: '' })),
        api.x402Supported().catch(() => null),
        api.x402Receipts().catch(() => ({ receipts: [] as X402Receipt[] })),
        api.x402Directory().catch(() => ({ services: [] as X402Service[] })),
        api.settlement().catch(() => null),
        api.x402Info().catch(() => null),
      ]);
      setRoot(rootRes);
      setSupported(supp);
      setReceipts(rcpts.receipts);
      setServices(dir.services);
      setSettlement(settle);
      setX402info(info);
      // Fetch reputation for each identity (bounded — one node's agents).
      const reps = await Promise.all(
        agentsRes.agents.map(async (agent) => ({
          agent,
          rep: await api.erc8004Reputation(agent.agentId).catch(() => undefined),
        })),
      );
      setRows(reps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // For the agent-owner view, narrow to the signed-in owner's agents when we can match them.
  const mine = useMemo(() => {
    if (scope !== 'agent') return rows;
    if (!me) return rows;
    const owned = rows.filter((r) => r.agent.web3Id === me || r.agent.agentDomain === me);
    return owned.length ? owned : rows;
  }, [rows, scope, me]);

  const ownFilterActive = scope === 'agent' && !!me && mine.length < rows.length;

  return (
    <div>
      <div className="section-title">
        {scope === 'agent' ? 'x402 · ERC-8004' : 'x402 & ERC-8004'}
      </div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 20, maxWidth: 640 }}>
        The two Web 4.0 standards Web3.0 speaks: <b>x402</b> for money (agents pay per request in
        USDC) and <b>ERC-8004</b> for identity &amp; reputation (agents are discoverable and
        trustable).{' '}
        {scope === 'agent'
          ? 'Here you manage your agents’ earnings and trust.'
          : 'Here you monitor the node’s payment facilitator and its agent registry.'}
      </p>

      {error && (
        <div
          className="card"
          style={{ borderLeft: '3px solid var(--no,#c0392b)', marginBottom: 18 }}
        >
          <b>Couldn’t reach the node.</b> <span className="muted">{error}</span>
        </div>
      )}

      {/* ── Section 1 — x402 · money ─────────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>💸</span> x402 — money
        </div>
        {x402info && (
          <div
            className="muted"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              margin: '2px 0 14px',
              fontSize: 'var(--fs-small, 13px)',
            }}
          >
            <span
              className="pill"
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                border: '1px solid var(--hair)',
              }}
            >
              {x402info.live ? '🟢 Live settlement' : '🧪 Sandbox (ledger)'} · {x402info.network}
            </span>
            {x402info.faucetUrl && (
              <>
                <span>Need test USDC to try a payment?</span>
                <a
                  href={x402info.faucetUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="btn"
                  style={{ padding: '3px 10px' }}
                >
                  Get testnet USDC ↗
                </a>
              </>
            )}
          </div>
        )}
        {scope === 'node' ? (
          <NodeX402 supported={supported} receipts={receipts} settlement={settlement} />
        ) : (
          <AgentX402
            rows={mine}
            services={services.filter((s) => mine.some((m) => m.agent.web3Id === s.web3Id))}
            loading={loading}
            onBound={load}
          />
        )}
      </div>

      {/* ── Section 2 — ERC-8004 · identity & reputation ─────────────────────────────────────── */}
      <div className="card">
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🪪</span> ERC-8004 — identity &amp; reputation
        </div>
        {scope === 'node' ? (
          <NodeErc8004 root={root} rows={rows} loading={loading} />
        ) : (
          <AgentErc8004 rows={mine} loading={loading} filtered={ownFilterActive} />
        )}
      </div>
    </div>
  );
}

// ── x402: node operator view ─────────────────────────────────────────────────────────────────────

function NodeX402({
  supported,
  receipts,
  settlement,
}: {
  supported: X402Supported | null;
  receipts: X402Receipt[];
  settlement: SettlementInfo | null;
}) {
  const total = receipts.reduce((n, r) => {
    try {
      return n + BigInt(r.amount || '0');
    } catch {
      return n;
    }
  }, 0n);
  const uniquePayers = new Set(receipts.map((r) => r.payer).filter(Boolean)).size;
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        This node is a <b>permissionless x402 facilitator</b>: any x402 server can settle USDC
        through it — no signup, no API keys. Below is what it has settled.
      </p>
      <div className="stats">
        <div className="stat">
          <div className="k">Settled volume</div>
          <div className="n">{usdc(total.toString())}</div>
        </div>
        <div className="stat">
          <div className="k">Payments</div>
          <div className="n">{receipts.length}</div>
        </div>
        <div className="stat">
          <div className="k">Unique payers</div>
          <div className="n">{uniquePayers}</div>
        </div>
        <div className="stat">
          <div className="k">Settlement rail</div>
          <div className="n" style={{ fontSize: '1rem' }}>
            {settlement?.mode ?? '—'}
          </div>
        </div>
      </div>
      <div className="muted" style={{ margin: '4px 0 14px' }}>
        Networks accepted:{' '}
        {supported?.kinds.length
          ? supported.kinds.map((k) => `${k.scheme}·${k.network}`).join(', ')
          : '—'}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Payer</th>
              <th>Amount</th>
              <th>Network</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No x402 settlements yet.
                </td>
              </tr>
            )}
            {receipts.slice(0, 25).map((r) => (
              <tr key={r.transaction + r.at}>
                <td className="muted">{new Date(r.at).toLocaleTimeString()}</td>
                <td className="mono-hash">{r.payer ? short(r.payer) : '—'}</td>
                <td>{usdc(r.amount)}</td>
                <td>{r.network}</td>
                <td className="mono-hash">
                  {r.explorerUrl ? (
                    <a href={r.explorerUrl} target="_blank" rel="noreferrer">
                      {short(r.transaction)}
                    </a>
                  ) : (
                    short(r.transaction)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <OxygenPanel />
    </div>
  );
}

// ── x402: agent-owner view ───────────────────────────────────────────────────────────────────────

function AgentX402({
  rows,
  services,
  loading,
  onBound,
}: {
  rows: AgentRep[];
  services: X402Service[];
  loading: boolean;
  onBound: () => void;
}) {
  const [agentId, setAgentId] = useState<number | ''>('');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const bind = async () => {
    if (agentId === '' || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setMsg('Pick an agent and enter a valid 0x… address.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.erc8004Bind(Number(agentId), addr);
      setMsg('Wallet bound — payments to it now build this agent’s reputation.');
      setAddr('');
      onBound();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Bind failed.');
    } finally {
      setBusy(false);
    }
  };

  const totalEarned = rows.reduce((n, r) => {
    try {
      return n + BigInt(r.rep?.earnings.totalEarnedAtomic ?? '0');
    } catch {
      return n;
    }
  }, 0n);
  const totalPayments = rows.reduce((n, r) => n + (r.rep?.earnings.paymentCount ?? 0), 0);

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Your agents earn USDC when other agents pay for their skills via x402. Earnings also lift
        each agent’s <b>economic reputation</b> below.
      </p>
      <div className="stats">
        <div className="stat">
          <div className="k">Total earned</div>
          <div className="n">{usdc(totalEarned.toString())}</div>
        </div>
        <div className="stat">
          <div className="k">Payments received</div>
          <div className="n">{totalPayments}</div>
        </div>
        <div className="stat">
          <div className="k">Your agents</div>
          <div className="n">{rows.length}</div>
        </div>
      </div>

      <div className="table-scroll" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>x402 wallet</th>
              <th>Earned</th>
              <th>Payments</th>
              <th>Payers</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No agents yet — create one in Genesis.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.agent.agentId}>
                <td>
                  {r.agent.agentDomain} <span className="muted">#{r.agent.agentId}</span>
                </td>
                <td className="mono-hash">{short(r.agent.agentAddress)}</td>
                <td>{usdc(r.rep?.earnings.totalEarnedAtomic ?? '0')}</td>
                <td>{r.rep?.earnings.paymentCount ?? 0}</td>
                <td>{r.rep?.earnings.uniquePayers ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title" style={{ fontSize: '1rem' }}>
        Your x402 endpoints (auto-generated)
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Every skill you priced is automatically a pay-per-call x402 API — no setup. Share the URL;
        callers pay your rate and the earnings build your agent’s reputation above.
      </p>
      {services.length === 0 ? (
        <p className="muted">
          No priced skills yet. Give an agent a <code>pricing.perTask</code> in Genesis and its
          skills appear here as paid endpoints.
        </p>
      ) : (
        <div className="table-scroll" style={{ marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Skill</th>
                <th>Price</th>
                <th>Endpoint</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {services.map((s) => {
                const url = `${NODE_URL}${s.endpoint}`;
                return (
                  <tr key={s.endpoint}>
                    <td>
                      {s.name} <span className="muted">· {s.web3Id}</span>
                    </td>
                    <td>${s.priceUsd}</td>
                    <td className="mono-hash">{s.endpoint}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => navigator.clipboard?.writeText(url)}
                      >
                        Copy URL
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title" style={{ fontSize: '1rem' }}>
        Bind an x402 receiving wallet
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Point one of your agents at the USDC address it gets paid to. Payments to that address then
        count toward its ERC-8004 economic reputation.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Select agent…</option>
          {rows.map((r) => (
            <option key={r.agent.agentId} value={r.agent.agentId}>
              {r.agent.agentDomain} (#{r.agent.agentId})
            </option>
          ))}
        </select>
        <input
          placeholder="0x… receiving address"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          style={{ minWidth: 320, fontFamily: 'monospace' }}
        />
        <button type="button" className="btn" onClick={bind} disabled={busy}>
          {busy ? 'Binding…' : 'Bind wallet'}
        </button>
      </div>
      {msg && (
        <div className="muted" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}

      <OxygenPanel />
    </div>
  );
}

// ── ERC-8004: node operator view ─────────────────────────────────────────────────────────────────

function NodeErc8004({
  root,
  rows,
  loading,
}: {
  root: Erc8004Root | null;
  rows: AgentRep[];
  loading: boolean;
}) {
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Every agent on this node is an <b>ERC-8004 Trustless Agent</b> — discoverable and trustable
        by any external agent built on the standard.
      </p>
      <div className="stats">
        <div className="stat">
          <div className="k">Registered agents</div>
          <div className="n">{root?.agentCount ?? rows.length}</div>
        </div>
        <div className="stat" style={{ gridColumn: 'span 2' }}>
          <div className="k">Registry (CAIP-10)</div>
          <div className="n mono-hash" style={{ fontSize: '0.85rem', whiteSpace: 'normal' }}>
            {root?.registry ?? '—'}
          </div>
        </div>
      </div>
      <div className="muted" style={{ margin: '2px 0 14px' }}>
        Discovery root: <span className="mono-hash">/.well-known/erc8004.json</span>
      </div>
      <IdentityTable rows={rows} loading={loading} />
    </div>
  );
}

// ── ERC-8004: agent-owner view ───────────────────────────────────────────────────────────────────

function AgentErc8004({
  rows,
  loading,
  filtered,
}: {
  rows: AgentRep[];
  loading: boolean;
  filtered: boolean;
}) {
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Each of your agents has a portable identity (a DID + a derived wallet address) and a
        reputation that blends <b>client feedback</b> with <b>x402 earnings</b>.
        {filtered ? ' Showing agents linked to your account.' : ''}
      </p>
      <IdentityTable rows={rows} loading={loading} showTrust />
    </div>
  );
}

// ── shared identity + reputation table ─────────────────────────────────────────────────────────────

function IdentityTable({
  rows,
  loading,
  showTrust,
}: {
  rows: AgentRep[];
  loading: boolean;
  showTrust?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Agent</th>
            <th>Address</th>
            <th>DID</th>
            <th>Feedback</th>
            <th>Economic</th>
            <th>Trust{showTrust ? '' : ' (combined)'}</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={7} className="muted">
                Loading…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No agents registered yet.
              </td>
            </tr>
          )}
          {rows.map(({ agent, rep }) => (
            <tr key={agent.agentId}>
              <td>{agent.agentId}</td>
              <td>{agent.agentDomain}</td>
              <td className="mono-hash">{short(agent.agentAddress)}</td>
              <td className="mono-hash">{agent.did ? short(agent.did, 10, 4) : '—'}</td>
              <td>
                {rep && rep.summary.count > 0 ? (
                  <span>
                    {rep.summary.averageScore} <span className="muted">({rep.summary.count})</span>
                  </span>
                ) : (
                  <span className="muted">none</span>
                )}
              </td>
              <td>
                {rep && rep.earnings.paymentCount > 0 ? (
                  <span>
                    {rep.combined.economicScore}{' '}
                    <span className="muted">({rep.earnings.paymentCount} pmt)</span>
                  </span>
                ) : (
                  <span className="muted">none</span>
                )}
              </td>
              <td style={{ minWidth: 120 }}>
                <Meter score={rep?.combined.score ?? 0} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
