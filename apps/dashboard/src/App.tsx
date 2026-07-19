import { useEffect, useState } from 'react';
import { Connectors } from './Connectors.js';
import { Developers } from './Developers.js';
import { Download } from './Download.js';
import { Genesis } from './Genesis.js';
import { HostedDapps } from './HostedDapps.js';
import { Network } from './Network.js';
import { Operator } from './Operator.js';
import { Skills } from './Skills.js';
import { Telegram } from './Telegram.js';
import {
  type AcpEvent,
  type AgentCard,
  type Guardrails,
  type LedgerEntry,
  NODE_URL,
  type Stats,
  type Wallet,
  api,
  formatAmount,
} from './api.js';

type View =
  | 'overview'
  | 'mynode'
  | 'agents'
  | 'skills'
  | 'network'
  | 'connectors'
  | 'traffic'
  | 'ledger'
  | 'guardrails'
  | 'genesis'
  | 'hosteddapps'
  | 'telegram'
  | 'developers'
  | 'download';

interface Snapshot {
  stats?: Stats;
  agents: AgentCard[];
  events: AcpEvent[];
  wallets: Wallet[];
  entries: LedgerEntry[];
  ledgerVerified: boolean;
  guardrails?: Guardrails;
  online: boolean;
}

const EMPTY: Snapshot = {
  agents: [],
  events: [],
  wallets: [],
  entries: [],
  ledgerVerified: true,
  online: false,
};

function kindClass(kind: string): string {
  const key = kind.split('.')[0];
  return `k-${key}`;
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function App() {
  const [view, setView] = useState<View>('overview');
  const [snap, setSnap] = useState<Snapshot>(EMPTY);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const [stats, agents, events, ledger, guardrails] = await Promise.all([
          api.stats(),
          api.agents(),
          api.events(60),
          api.ledger(),
          api.guardrails(),
        ]);
        if (!active) return;
        setSnap({
          stats,
          agents: agents.agents,
          events: events.events,
          wallets: ledger.wallets,
          entries: ledger.entries,
          ledgerVerified: ledger.verify.ok,
          guardrails,
          online: true,
        });
      } catch {
        if (active) setSnap((s) => ({ ...s, online: false }));
      }
    }
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <span className="badge">A</span> ACP
        </div>
        <p className="tagline">the agentic internet · console</p>
        <NavItem id="overview" label="Overview" view={view} set={setView} />
        <NavItem id="mynode" label="My node · earnings" view={view} set={setView} />
        <NavItem id="agents" label="Agents" view={view} set={setView} count={snap.agents.length} />
        <NavItem id="skills" label="Skills" view={view} set={setView} />
        <NavItem id="network" label="Network" view={view} set={setView} />
        <NavItem id="connectors" label="Connectors" view={view} set={setView} />
        <NavItem
          id="traffic"
          label="Live traffic"
          view={view}
          set={setView}
          count={snap.events.length}
        />
        <NavItem
          id="ledger"
          label="Payments & ledger"
          view={view}
          set={setView}
          count={snap.entries.length}
        />
        <NavItem id="guardrails" label="Guardrails" view={view} set={setView} />
        <NavItem id="genesis" label="Genesis · new agent" view={view} set={setView} />
        <NavItem id="hosteddapps" label="Hosted dApps" view={view} set={setView} />
        <NavItem id="developers" label="Developers" view={view} set={setView} />
        <NavItem id="download" label="Run a node" view={view} set={setView} />
        <NavItem id="telegram" label="Telegram bot" view={view} set={setView} />
        <div className="foot">
          <span className={`pill-live ${snap.online ? '' : 'pill-off'}`}>
            <span className="dot" /> {snap.online ? 'node online' : 'node offline'}
          </span>
        </div>
      </aside>

      <main className="main">
        {view === 'overview' && <Overview snap={snap} />}
        {view === 'mynode' && <Operator />}
        {view === 'agents' && <Agents agents={snap.agents} wallets={snap.wallets} />}
        {view === 'skills' && <Skills agents={snap.agents} />}
        {view === 'network' && <Network />}
        {view === 'connectors' && <Connectors go={(v) => setView(v as View)} />}
        {view === 'traffic' && <Traffic events={snap.events} />}
        {view === 'ledger' && <LedgerView snap={snap} />}
        {view === 'guardrails' && <GuardrailsView snap={snap} />}
        {view === 'genesis' && <Genesis />}
        {view === 'hosteddapps' && <HostedDapps />}
        {view === 'developers' && <Developers />}
        {view === 'download' && <Download />}
        {view === 'telegram' && <Telegram />}
      </main>
    </div>
  );
}

function NavItem(props: {
  id: View;
  label: string;
  view: View;
  set: (v: View) => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      className={`navitem ${props.view === props.id ? 'active' : ''}`}
      onClick={() => props.set(props.id)}
    >
      <span>{props.label}</span>
      {props.count !== undefined && <span className="count">{props.count}</span>}
    </button>
  );
}

function Overview({ snap }: { snap: Snapshot }) {
  const s = snap.stats;
  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
        <span className={`pill-live ${snap.online ? '' : 'pill-off'}`}>
          <span className="dot" /> {NODE_URL}
        </span>
      </div>
      <div className="stats">
        <Stat k="Agents" n={s ? String(s.agents) : '—'} />
        <Stat k="Online now" n={s ? String(s.online) : '—'} />
        <Stat
          k="Value in network"
          n={
            s
              ? (s.totalValue / 100).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : '—'
          }
          unit={s ? 'aETH' : undefined}
        />
        <Stat k="Ledger entries" n={s ? String(s.ledgerEntries) : '—'} />
        <Stat k="Ledger integrity" n={snap.ledgerVerified ? 'verified' : 'BROKEN'} />
      </div>
      <div className="section-title">Recent activity</div>
      <div className="card">
        <Feed events={snap.events.slice(0, 12)} />
      </div>
    </>
  );
}

function Stat({ k, n, unit }: { k: string; n: string; unit?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="n">
        {n}
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

function Agents({ agents, wallets }: { agents: AgentCard[]; wallets: Wallet[] }) {
  const balanceOf = (id: string) => wallets.find((w) => w.owner === id)?.balance ?? 0;
  return (
    <>
      <div className="page-head">
        <h1>Agents</h1>
      </div>
      <div className="card">
        {agents.length === 0 ? (
          <div className="empty">No agents registered yet. Run the two-agents demo.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Web3.0 ID</th>
                <th>Kind</th>
                <th>Skills</th>
                <th>Wallet</th>
                <th>DID</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.web3Id}>
                  <td>
                    <strong>{a.web3Id}</strong>
                  </td>
                  <td>
                    <span className="chip">{a.kind}</span>
                  </td>
                  <td>
                    {a.skills.map((sk) => sk.id).join(', ') || <span className="muted">—</span>}
                  </td>
                  <td>{formatAmount(balanceOf(a.web3Id))}</td>
                  <td className="mono-hash">{a.did.slice(0, 22)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Traffic({ events }: { events: AcpEvent[] }) {
  return (
    <>
      <div className="page-head">
        <h1>Live traffic</h1>
        <span className="muted">
          agent-to-agent messages, tasks, payments & guardrail decisions
        </span>
      </div>
      <div className="card">
        <Feed events={events} />
      </div>
    </>
  );
}

function Feed({ events }: { events: AcpEvent[] }) {
  if (events.length === 0) return <div className="empty">Waiting for activity…</div>;
  return (
    <div className="feed">
      {events.map((e) => {
        const decision = (e.data?.decision as string | undefined) ?? undefined;
        return (
          <div className="feed-row" key={e.id}>
            <span className="kind">
              <span className={`dot ${kindClass(e.kind)}`} /> {e.kind}
            </span>
            <span className="summary">{e.summary}</span>
            {decision ? (
              <span className={`chip ${decision === 'ALLOW' ? 'allow' : 'deny'}`}>{decision}</span>
            ) : (
              <span className="when">{shortTime(e.ts)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LedgerView({ snap }: { snap: Snapshot }) {
  return (
    <>
      <div className="page-head">
        <h1>Payments & ledger</h1>
        <span className={`pill-live ${snap.ledgerVerified ? '' : 'pill-off'}`}>
          <span className="dot" /> {snap.ledgerVerified ? 'chain verified' : 'chain BROKEN'}
        </span>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="section-title">Wallets</div>
          {snap.wallets.length === 0 ? (
            <div className="empty">No wallets yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Owner</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {snap.wallets.map((w) => (
                  <tr key={w.owner}>
                    <td>{w.owner}</td>
                    <td>{formatAmount(w.balance, w.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="section-title">Ledger entries</div>
          {snap.entries.length === 0 ? (
            <div className="empty">No entries yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {snap.entries.map((e) => (
                  <tr key={e.hash}>
                    <td>{e.seq}</td>
                    <td>
                      <span className="chip">{e.type}</span>
                    </td>
                    <td className="mono-hash">{e.hash.slice(0, 18)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function GuardrailsView({ snap }: { snap: Snapshot }) {
  const g = snap.guardrails;
  const decisions = snap.events.filter((e) => e.kind === 'guardrail.decision');
  return (
    <>
      <div className="page-head">
        <h1>Guardrails</h1>
      </div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Active policies</div>
        {g ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {g.policies.map((p) => (
              <span className="chip" key={p}>
                {p}
              </span>
            ))}
          </div>
        ) : (
          <div className="empty">—</div>
        )}
      </div>
      <div className="card">
        <div className="section-title">Recent decisions</div>
        {decisions.length === 0 ? (
          <div className="empty">No guardrail decisions yet.</div>
        ) : (
          <Feed events={decisions} />
        )}
      </div>
    </>
  );
}
