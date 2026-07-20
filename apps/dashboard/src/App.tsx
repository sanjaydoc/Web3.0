import { useCallback, useEffect, useState } from 'react';
import { Account } from './Account.js';
import { Connectors } from './Connectors.js';
import { InstallBanner } from './InstallBanner.js';
import { InstallButton } from './InstallButton.js';
import { Developers } from './Developers.js';
import { Download } from './Download.js';
import { Genesis } from './Genesis.js';
import { HostedDapps } from './HostedDapps.js';
import { Landing } from './Landing.js';
import { Network } from './Network.js';
import { Operator } from './Operator.js';
import { Skills } from './Skills.js';
import { Telegram } from './Telegram.js';
import {
  type Account as Acct,
  type AgentCard,
  type Guardrails,
  type LedgerEntry,
  NODE_URL,
  type Stats,
  type Wallet,
  type Web3Event,
  api,
  formatAmount,
  getWeb3Token,
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
  | 'account'
  | 'download';

type Role = 'operator' | 'admin';
const ROLE_KEY = 'web3.role';

/** Sidebar entries. `operator: true` = shown to node operators too; the rest are admin-only. */
const NAV: {
  id: View;
  label: string;
  badge?: 'agents' | 'events' | 'entries';
  operator?: boolean;
}[] = [
  { id: 'overview', label: 'Overview', operator: true },
  { id: 'account', label: 'Account', operator: true },
  { id: 'download', label: 'Run a node', operator: true },
  { id: 'mynode', label: 'My node · earnings', operator: true },
  { id: 'network', label: 'Network', operator: true },
  { id: 'connectors', label: 'Connectors', operator: true },
  { id: 'skills', label: 'Skills', operator: true },
  { id: 'ledger', label: 'Payments & ledger', badge: 'entries' },
  { id: 'telegram', label: 'Telegram bot', operator: true },
  { id: 'genesis', label: 'Genesis · new agent', operator: true },
  { id: 'developers', label: 'Developers', operator: true },
  { id: 'hosteddapps', label: 'Hosted dApps', operator: true },
  { id: 'agents', label: 'Agents', badge: 'agents' },
  { id: 'traffic', label: 'Live traffic', badge: 'events' },
  { id: 'guardrails', label: 'Guardrails' },
];

interface Snapshot {
  stats?: Stats;
  agents: AgentCard[];
  events: Web3Event[];
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
  // Admin-only view preference (which mode an admin is previewing). Non-admins ignore it.
  const [rolePref, setRolePref] = useState<Role>(() =>
    localStorage.getItem(ROLE_KEY) === 'operator' ? 'operator' : 'admin',
  );
  // Auth gate: null = still checking, true = signed in, false = show the landing.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [guest, setGuest] = useState(false);
  const [account, setAccount] = useState<Acct | null>(null);

  const checkAuth = useCallback(async () => {
    if (!getWeb3Token()) {
      setAccount(null);
      setAuthed(false);
      return;
    }
    try {
      const me = await api.me();
      setAccount(me);
      setAuthed(true);
    } catch {
      setAccount(null);
      setAuthed(false); // stale/invalid token → back to landing
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // The signed-in account's real role governs access: only an admin account sees admin sections
  // and the Operator/Admin toggle. Operators, developers, and guests are locked to the operator view.
  const isAdmin = account?.role === 'admin';
  const role: Role = isAdmin ? rolePref : 'operator';

  const visibleNav = NAV.filter((n) => role === 'admin' || n.operator);

  const changeRole = (r: Role) => {
    setRolePref(r);
    localStorage.setItem(ROLE_KEY, r);
    // If the current page isn't in the new role's menu, fall back to Overview.
    if (r === 'operator' && !NAV.find((n) => n.id === view)?.operator) setView('overview');
  };

  // Never leave a non-admin sitting on an admin-only view (e.g. after switching accounts).
  useEffect(() => {
    if (role === 'operator' && !NAV.find((n) => n.id === view)?.operator) setView('overview');
  }, [role, view]);

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

  // Landing gate — shown until the visitor signs in (or chooses to explore an open node).
  if (authed === null) return <div className="landing" aria-busy="true" />;
  if (!authed && !guest) {
    return (
      <>
        <InstallBanner />
        <Landing onEnter={() => checkAuth()} onGuest={() => setGuest(true)} />
      </>
    );
  }

  return (
    <div className="app">
      <InstallBanner />
      <aside className="side">
        <div className="brand">
          <span className="badge">W</span> Web3.0
        </div>
        <p className="tagline">the agentic internet · console</p>
        {isAdmin && (
          <div className="role-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={role === 'operator' ? 'active' : ''}
              onClick={() => changeRole('operator')}
            >
              Operator
            </button>
            <button
              type="button"
              className={role === 'admin' ? 'active' : ''}
              onClick={() => changeRole('admin')}
            >
              Admin
            </button>
          </div>
        )}
        {visibleNav.map((n) => (
          <NavItem
            key={n.id}
            id={n.id}
            label={n.label}
            view={view}
            set={setView}
            count={
              n.badge === 'agents'
                ? snap.agents.length
                : n.badge === 'events'
                  ? snap.events.length
                  : n.badge === 'entries'
                    ? snap.entries.length
                    : undefined
            }
          />
        ))}
        <div className="foot">
          <span className={`pill-live ${snap.online ? '' : 'pill-off'}`}>
            <span className="dot" /> {snap.online ? 'node online' : 'node offline'}
          </span>
          <InstallButton className="btn act btn-install" />
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
        {view === 'hosteddapps' && <HostedDapps admin={role === 'admin'} />}
        {view === 'developers' && <Developers />}
        {view === 'account' && <Account />}
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

function Traffic({ events }: { events: Web3Event[] }) {
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

function Feed({ events }: { events: Web3Event[] }) {
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
