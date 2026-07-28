import { useCallback, useEffect, useState } from 'react';
import { Account } from './Account.js';
import { Connectors } from './Connectors.js';
import { Developers } from './Developers.js';
import { Download } from './Download.js';
import { Genesis } from './Genesis.js';
import { HostedDapps } from './HostedDapps.js';
import { InstallBanner } from './InstallBanner.js';
import { InstallButton } from './InstallButton.js';
import { Landing } from './Landing.js';
import { Network } from './Network.js';
import { Onboarding } from './Onboarding.js';
import { Operator } from './Operator.js';
import { Skills } from './Skills.js';
import { Telegram } from './Telegram.js';
import {
  type Account as Acct,
  type AgentCard,
  type Guardrails,
  type HostedAgent,
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
const ONBOARDED_KEY = 'web3.onboarded';

/** Sidebar entries. `operator: true` = shown to node operators too; the rest are admin-only. */
const NAV: {
  id: View;
  label: string;
  badge?: 'agents' | 'events' | 'entries';
  operator?: boolean;
}[] = [
  // Operator-visible items show ONLY the signed-in account's own data (their account, their
  // earnings, their agents/dApps). Everything network-wide or node-owner (overview aggregates,
  // the network map, the skills/connectors registries, node Telegram config, all-agents, the full
  // ledger, live traffic, guardrails) is admin-only — a non-admin never mounts them.
  { id: 'overview', label: 'Overview' },
  { id: 'account', label: 'Account', operator: true },
  { id: 'download', label: 'Run a node', operator: true },
  { id: 'mynode', label: 'My node · earnings', operator: true },
  { id: 'network', label: 'Network' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'skills', label: 'Skills' },
  { id: 'ledger', label: 'Payments & ledger', badge: 'entries' },
  { id: 'telegram', label: 'Telegram bot' },
  { id: 'genesis', label: 'Genesis · new agent', operator: true },
  { id: 'developers', label: 'Developers', operator: true },
  { id: 'hosteddapps', label: 'Hosted dApps', operator: true },
  { id: 'agents', label: 'Agents', badge: 'agents' },
  { id: 'traffic', label: 'Live traffic', badge: 'events' },
  { id: 'guardrails', label: 'Guardrails' },
];

/** Where a non-admin lands (and falls back to) — their own earnings, never an admin view. */
const OPERATOR_HOME: View = 'mynode';

/**
 * Views that consume the node's compute/hosting. On the admin-only MAIN node these are reserved for
 * the admin, so a non-admin viewer never mounts them — they're pointed at "Run a node" to do this on
 * their own node instead. (On a normal node, nothing is locked and these stay available.)
 */
const LOCKED_ON_MAIN = new Set<View>(['genesis', 'developers', 'hosteddapps']);

/** Views reserved for a real admin even on your own node — network-wide observability an operator
 *  running a single node doesn't need. */
const ADMIN_ONLY = new Set<View>(['network', 'traffic']);

/**
 * The two personas differ by only these items; everything else in the console (Overview, Account,
 * Connectors, Skills, Payments, Telegram, Agents, Guardrails) is shared:
 *  - HOST_ONLY — running/earning from a node. Operators only; an agent-owner never sees these.
 *  - OWNER_ONLY — creating & managing your own agents. Agent-owners only; an operator never sees these.
 * OWNER_ONLY views stay in LOCKED_ON_MAIN, so on the reserved main node an owner can't launch there
 * until they have a host to run on (the marketplace).
 */
const HOST_ONLY = new Set<View>(['download', 'mynode']);
const OWNER_ONLY = new Set<View>(['genesis', 'developers', 'hosteddapps']);

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
  // Is the node reachable? Polled for EVERYONE (the admin data-poll below is admin-only, so operators
  // would otherwise always read snap.online === false and see a wrong "node offline" in the footer).
  const [nodeOnline, setNodeOnline] = useState(false);
  // Mobile nav drawer (the sidebar collapses behind a hamburger below 760px).
  const [menuOpen, setMenuOpen] = useState(false);
  // Admin-only view preference (which mode an admin is previewing). Non-admins ignore it.
  const [rolePref, setRolePref] = useState<Role>(() =>
    localStorage.getItem(ROLE_KEY) === 'operator' ? 'operator' : 'admin',
  );
  // Auth gate: null = still checking, true = signed in, false = show the landing.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [guest, setGuest] = useState(false);
  const [account, setAccount] = useState<Acct | null>(null);
  // First-run onboarding is the desktop app's FRONT PAGE: on every open it greets the operator with
  // the "Run a node — quick setup" wizard until they finish it (or sign in with an existing account),
  // which sets ONBOARDED_KEY. We deliberately do NOT treat a mere saved token as "onboarded" — the
  // Electron app keeps localStorage across reinstalls, so a leftover token from earlier use must not
  // suppress the wizard. It only ever shows on a real own node (not the reserved main node) — see gate.
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDED_KEY) === '1');
  // Lets anyone re-open the wizard on demand from the dashboard ("Get started"), even after the
  // one-time auto-onboarding is done.
  const [forceOnboard, setForceOnboard] = useState(false);
  const finishOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDED_KEY, '1');
    setOnboarded(true);
    setForceOnboard(false);
  }, []);

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

  // Is the node this dashboard points at the network's admin-only main node? Public on /node, so we
  // can learn it even as a guest. When true and the viewer isn't admin, we steer them to run their
  // own node instead of operating against the main node (hosting there is refused server-side).
  const [adminOnly, setAdminOnly] = useState(false);
  // The node's treasury address (fees + block rewards). It's node infrastructure, not a user agent,
  // and the treasury concept is admin-only — so a non-admin never sees it listed among the agents.
  const [treasuryId, setTreasuryId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const ping = () =>
      api
        .node()
        .then((n) => {
          if (!active) return;
          setAdminOnly(Boolean(n.auth?.adminOnly));
          setTreasuryId(n.treasuryId ?? null);
          setNodeOnline(true);
        })
        .catch(() => active && setNodeOnline(false));
    ping();
    const t = setInterval(ping, 4000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  // The signed-in account's real role governs access: only an admin account sees admin sections
  // and the Operator/Admin toggle. Operators, developers, and guests are locked to the operator view.
  const isAdmin = account?.role === 'admin';
  // The agent-owner persona (create/own agents, pay a host) sees the create-agent views but not the
  // host views; the operator persona is the reverse. Mutually exclusive at signup.
  const isAgentOwner = account?.role === 'agent-owner';
  const isOperator = !isAdmin && !isAgentOwner; // operator/developer/guest → node-operator persona
  const role: Role = isAdmin ? rolePref : 'operator';

  // Agents a non-admin may see: the treasury is admin-only node infrastructure, so drop it from the
  // list (and the nav badge count) for operators. Admins still see it.
  const agentsForView =
    isAdmin || !treasuryId ? snap.agents : snap.agents.filter((a) => a.web3Id !== treasuryId);

  // A non-admin on the main node: hosting/publishing here is reserved for the admin, so hide those
  // views and make "Run a node" their home — participation happens on their own node.
  const mainNodeLocked = adminOnly && !isAdmin;
  const operatorHome: View = mainNodeLocked ? 'download' : OPERATOR_HOME;
  // Where each persona lands (and falls back to). An agent-owner's home is Genesis (create an agent);
  // on the reserved main node, where hosting is locked, they fall back to their Account until a host
  // (the marketplace) is available.
  const personaHome: View = isAgentOwner ? (mainNodeLocked ? 'account' : 'genesis') : operatorHome;

  // You get the FULL node console (network, ledger, connectors, skills, telegram, …) whenever you
  // run THIS node: an admin on any node, OR any operator on a node that isn't the reserved main node
  // — i.e. their own desktop/self-hosted node. On the admin-only main node an operator stays limited
  // to their personal items. (ownsNode === !mainNodeLocked, named for readability.)
  const ownsNode = !mainNodeLocked;

  const visibleNav = NAV.filter((n) => {
    // Admin sees the whole console; the Operator/Admin toggle only changes which data is previewed.
    if (isAdmin) return true;
    // Persona differentiators: hosts see HOST_ONLY, owners see OWNER_ONLY, never the other's.
    if (HOST_ONLY.has(n.id) && !isOperator) return false;
    if (OWNER_ONLY.has(n.id) && !isAgentOwner) return false;
    // Shared console: the full node view on your own node, or the operator-safe items on the main node.
    return (
      (ownsNode || n.operator) &&
      !(mainNodeLocked && LOCKED_ON_MAIN.has(n.id)) &&
      !ADMIN_ONLY.has(n.id)
    );
  });

  const changeRole = (r: Role) => {
    setRolePref(r);
    localStorage.setItem(ROLE_KEY, r);
    // If the current page isn't in the new role's menu, fall back to the operator home.
    if (r === 'operator' && !NAV.find((n) => n.id === view)?.operator) setView(operatorHome);
  };

  // Never leave a non-admin sitting on a view that isn't in their persona's menu — send them home.
  const visibleKey = visibleNav.map((n) => n.id).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: visibleKey is the stable signature of visibleNav
  useEffect(() => {
    if (isAdmin) return;
    if (!visibleNav.some((n) => n.id === view)) setView(personaHome);
  }, [visibleKey, view, personaHome, isAdmin]);

  useEffect(() => {
    // The console's network/ledger views need this feed. Fetch it whenever the viewer owns this node
    // (admin, or an operator on their own node). On the main node a plain operator never renders
    // these views, so we skip the fetch — keeping their session to their own data.
    if (!ownsNode) return;
    let active = true;
    async function poll() {
      try {
        // A non-admin operator scopes the ledger to their OWN account, served from the full
        // replicated chain so their transactions stay populated across app restarts. Admin (on the
        // main node) pulls the whole-network ledger.
        const ledgerAccount = !isAdmin && account?.address ? account.address : undefined;
        const [stats, agents, events, ledger, guardrails] = await Promise.all([
          api.stats(),
          api.agents(),
          api.events(60),
          api.ledger(ledgerAccount),
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
  }, [ownsNode, isAdmin, account?.address]);

  // Landing gate — shown until the visitor signs in (or chooses to explore an open node).
  if (authed === null) return <div className="landing" aria-busy="true" />;

  // First-run onboarding is the FRONT PAGE on both surfaces — desktop (own node) and the website
  // (admin-only main node). It greets every not-yet-onboarded visitor with the "Run a node" wizard
  // until they finish it or sign in. We never force an admin through it (they sign in and manage the
  // network), and only show it once the node is reachable. On the main node the RAM step is an
  // informational earnings preview (canHost=false) since you host on your OWN node via the desktop app.
  if ((nodeOnline && !onboarded && !isAdmin) || forceOnboard) {
    return (
      <>
        <InstallBanner />
        <Onboarding
          authed={Boolean(authed)}
          canHost={!adminOnly}
          onAuthChanged={checkAuth}
          onDone={() => {
            finishOnboarding();
            void checkAuth();
          }}
          onSignInInstead={finishOnboarding}
        />
      </>
    );
  }

  if (!authed && !guest) {
    return (
      <>
        <InstallBanner />
        <Landing
          onEnter={() => checkAuth()}
          onGuest={() => setGuest(true)}
          // A brand-new account (Landing → Create account) goes straight into the onboarding flow —
          // pick up the new token, then force the wizard (it resumes past the name step and walks
          // location → RAM → save your key). Same onboarding component used on desktop/Android.
          onCreated={async () => {
            await checkAuth();
            setForceOnboard(true);
          }}
        />
      </>
    );
  }

  // Navigate + collapse the mobile drawer in one gesture.
  const go = (v: View) => {
    setView(v);
    setMenuOpen(false);
  };

  return (
    <div className={`app ${menuOpen ? 'menu-open' : ''}`}>
      <InstallBanner />

      {/* Mobile top bar — only visible below 760px (CSS). Hosts the brand + hamburger. */}
      <header className="mobile-bar">
        <div className="brand">
          <span className="badge">W</span> Web3.0
        </div>
        <button
          type="button"
          className="hamburger"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="hamburger-box">
            <span className="hamburger-inner" />
          </span>
        </button>
      </header>

      {/* Tap-away backdrop for the open drawer (mobile only). */}
      {menuOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside className={`side ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="badge">W</span> Web3.0
        </div>
        <p className="tagline">the agentic internet · console</p>
        {isAdmin && (
          // biome-ignore lint/a11y/useSemanticElements: styled segmented toggle; <fieldset> would break the flex layout
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
            set={go}
            count={
              n.badge === 'agents'
                ? agentsForView.length
                : n.badge === 'events'
                  ? snap.events.length
                  : n.badge === 'entries'
                    ? snap.entries.length
                    : undefined
            }
          />
        ))}
        <div className="foot">
          <span className={`pill-live ${nodeOnline ? '' : 'pill-off'}`}>
            <span className="dot" /> {nodeOnline ? 'node online' : 'node offline'}
          </span>
          <InstallButton className="btn act btn-install" />
        </div>
      </aside>

      <main className="main">
        {mainNodeLocked && (
          <MainNodeNotice go={() => setView('download')} onDownload={view === 'download'} />
        )}
        {view === 'overview' && <Overview snap={snap} />}
        {view === 'mynode' && <Operator />}
        {view === 'agents' && <Agents agents={agentsForView} wallets={snap.wallets} />}
        {view === 'skills' && <Skills agents={agentsForView} />}
        {view === 'network' && <Network />}
        {view === 'connectors' && <Connectors go={(v) => setView(v as View)} />}
        {view === 'traffic' && <Traffic events={snap.events} />}
        {view === 'ledger' && (
          <LedgerView snap={snap} admin={isAdmin} me={account?.address ?? null} />
        )}
        {view === 'guardrails' && <GuardrailsView snap={snap} />}
        {view === 'genesis' && <Genesis />}
        {view === 'hosteddapps' && <HostedDapps admin={role === 'admin'} />}
        {view === 'developers' && <Developers />}
        {view === 'account' && <Account />}
        {view === 'download' && (
          <Download onGetStarted={adminOnly ? undefined : () => setForceOnboard(true)} />
        )}
        {view === 'telegram' && <Telegram />}
      </main>
    </div>
  );
}

/** Banner shown to a non-admin viewing the network's admin-only main node. */
function MainNodeNotice({ go, onDownload }: { go: () => void; onDownload: boolean }) {
  return (
    <div
      className="card"
      style={{ marginBottom: 18, borderLeft: '3px solid var(--accent, #6a5cff)' }}
    >
      <div className="section-title">This is the network's main node</div>
      <p className="muted" style={{ margin: '2px 0 12px' }}>
        The main node is reserved for its admin. You can sign up, hold a wallet, and read the
        network here — but to <b>launch agents</b> and <b>earn aETH</b> for the compute you
        contribute, run your own node on your device. It joins the same network and your identity
        travels with you.
      </p>
      {!onDownload && (
        <button type="button" className="btn act" onClick={go}>
          Run a node →
        </button>
      )}
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
        <Stat k="Nodes online" n={s?.nodes !== undefined ? String(s.nodes) : '—'} />
        <Stat k="Total agents" n={s?.totalAgents !== undefined ? String(s.totalAgents) : '—'} />
        <Stat k="Agents" n={s ? String(s.agents) : '—'} />
        <Stat k="Agents online" n={s ? String(s.online) : '—'} />
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

  // Hosted agents (Genesis-created, running IN this node) are the ones we can start/stop. The node
  // returns only the caller's own hosted agents to a non-admin, so the Start/Stop control appears
  // only on rows the operator owns. Externally-run SDK agents aren't hosted here → no control.
  const [hosted, setHosted] = useState<HostedAgent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await api.hosted();
        if (active) setHosted(r.agents);
      } catch {
        /* node offline / not permitted — leave controls hidden */
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);
  const hostedById = new Map(hosted.map((h) => [h.web3Id, h]));

  const toggle = async (h: HostedAgent) => {
    setBusy(h.web3Id);
    try {
      const r = h.running ? await api.hostedStop(h.handle) : await api.hostedStart(h.handle);
      setHosted(r.agents);
    } catch {
      /* keep last state; the poll will reconcile */
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Agents</h1>
      </div>
      <div className="card">
        {agents.length === 0 ? (
          <div className="empty">No agents registered yet. Run the two-agents demo.</div>
        ) : (
          // Scroll wrapper: the columns overflow a phone's width; scroll inside the card instead of
          // the last columns bleeding past the edge. (Agents view only.)
          <div className="hscroll">
            <table>
              <thead>
                <tr>
                  <th>Web3.0 ID</th>
                  <th>Control</th>
                  <th>Kind</th>
                  <th>Skills</th>
                  <th>Wallet</th>
                  <th>DID</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const h = hostedById.get(a.web3Id);
                  return (
                    <tr key={a.web3Id}>
                      <td>
                        <strong>{a.web3Id}</strong>
                      </td>
                      <td>
                        {h ? (
                          <button
                            type="button"
                            className={`btn-run ${h.running ? 'btn-stop' : 'btn-start'}`}
                            disabled={busy === a.web3Id}
                            onClick={() => toggle(h)}
                          >
                            {busy === a.web3Id ? '…' : h.running ? 'Stop' : 'Start'}
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
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

/**
 * Decode a ledger entry into a readable From → To · Amount · label, straight from `entry.data`
 * (no server change needed — payments already carry from/to/amount). This is what turns the
 * opaque "payment / <hash>" rows into an auditable payments table: a transfer to sanjay@web3.0
 * reads as `you → sanjay@web3.0 · 5.00 aETH`, a faucet/reward as a `mint`.
 */
function describeEntry(e: LedgerEntry): {
  label: string;
  from: string;
  to: string;
  amount: string;
  note?: string;
} {
  const d = e.data as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const cur = str(d.currency) || 'aETH';
  switch (e.type) {
    case 'payment': {
      const amt = num(d.amount);
      const isMint = d.from === null || d.from === undefined;
      return {
        label: isMint ? 'mint' : 'transfer',
        from: isMint ? 'network' : str(d.from) || '—',
        to: str(d.to) || '—',
        amount: amt !== undefined ? formatAmount(amt, cur) : '—',
        note: str(d.memo) || undefined,
      };
    }
    case 'register': {
      const amt = num(d.openingBalance);
      return {
        label: 'register',
        from: 'network',
        to: str(d.web3Id) || '—',
        amount: amt && amt > 0 ? formatAmount(amt, cur) : '—',
        note: 'joined network',
      };
    }
    case 'account':
      return {
        label: 'key bind',
        from: '—',
        to: str(d.web3Id) || '—',
        amount: '—',
        note: str(d.role) ? `role: ${str(d.role)}` : undefined,
      };
    case 'message':
      return {
        label: 'message',
        from: str(d.from) || '—',
        to: str(d.to) || '—',
        amount: '—',
        note: str(d.bodyType) || undefined,
      };
    default:
      return { label: e.type, from: '—', to: '—', amount: '—' };
  }
}

/** Does a ledger entry reference this account (as sender, recipient, or subject)? */
function entryInvolves(e: LedgerEntry, address: string): boolean {
  const d = e.data as Record<string, unknown>;
  return d.from === address || d.to === address || d.web3Id === address;
}

function LedgerView({
  snap,
  admin,
  me,
}: {
  snap: Snapshot;
  admin: boolean;
  me: string | null;
}) {
  // Admin sees the whole network's ledger; a node operator sees ONLY their own account's
  // transactions (their address as sender, recipient, or subject). The node holds the full
  // replicated chain, so this is a UI scope — same pattern as the admin-only Wallets table.
  const entries = admin ? snap.entries : me ? snap.entries.filter((e) => entryInvolves(e, me)) : [];

  // A transfer shows in Recent activity the instant it's submitted, but only lands here once it's
  // SEALED into a block. Surface still-unsealed transfers as "pending" rows so a payment you just
  // made appears immediately (and doesn't look lost) — it turns into a sealed row when an authority
  // seals it. Keyed by from|to|amount|nonce so a tx already sealed isn't also shown as pending.
  const paymentKey = (d: { from?: unknown; to?: unknown; amount?: unknown; nonce?: unknown }) =>
    `${d.from}|${d.to}|${d.amount}|${d.nonce ?? ''}`;
  const sealedKeys = new Set(
    snap.entries
      .filter((e) => e.type === 'payment' && (e.data as { from?: unknown }).from != null)
      .map((e) => paymentKey(e.data as Record<string, unknown>)),
  );
  const seenPending = new Set<string>();
  const pending = snap.events
    .filter((e) => e.kind === 'tx.submitted')
    .map((e) => {
      const d = (e.data ?? {}) as {
        from?: unknown;
        to?: unknown;
        amount?: unknown;
        nonce?: unknown;
      };
      return {
        id: e.id,
        ts: e.ts,
        from: typeof d.from === 'string' ? d.from : '',
        to: typeof d.to === 'string' ? d.to : '',
        amount: typeof d.amount === 'number' ? d.amount : null,
        nonce: typeof d.nonce === 'number' ? d.nonce : undefined,
      };
    })
    .filter((p) => p.from && p.to && p.amount != null)
    .filter((p) => !sealedKeys.has(paymentKey(p))) // already sealed → shown as a real entry below
    .filter((p) => admin || (me != null && (p.from === me || p.to === me))) // role scope
    .filter((p) => {
      const k = paymentKey(p);
      if (seenPending.has(k)) return false;
      seenPending.add(k);
      return true;
    });
  return (
    <>
      <div className="page-head">
        <h1>Payments & ledger</h1>
        <span className={`pill-live ${snap.ledgerVerified ? '' : 'pill-off'}`}>
          <span className="dot" /> {snap.ledgerVerified ? 'chain verified' : 'chain BROKEN'}
        </span>
      </div>
      {/* Only the node's admin sees the Wallets balance table (everyone's balances). A plain node
          operator sees the ledger ACTIVITY but not other people's balances. */}
      <div className={admin ? 'grid-2' : ''}>
        {admin && (
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
        )}
        <div className="card">
          <div className="section-title">
            {admin ? 'Ledger entries' : 'Your transactions'}
            <span className="muted" style={{ fontWeight: 400 }}>
              {admin ? ' — entire network' : me ? ` — ${me}` : ''}
            </span>
          </div>
          {entries.length === 0 && pending.length === 0 ? (
            <div className="empty">
              {admin
                ? 'No entries yet.'
                : me
                  ? 'No transactions for your account yet.'
                  : 'Sign in to see your transactions.'}
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Type</th>
                    <th>From → To</th>
                    <th>Amount</th>
                    <th>Time</th>
                    <th>Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => (
                    <tr key={`pending-${p.id}`} style={{ opacity: 0.75 }}>
                      <td>—</td>
                      <td>
                        <span className="chip">pending</span>
                      </td>
                      <td>
                        <span>{p.from}</span>
                        <span className="muted"> → </span>
                        <span>{p.to}</span>
                      </td>
                      <td>{formatAmount(p.amount as number)}</td>
                      <td className="muted">{shortTime(p.ts)}</td>
                      <td className="muted">awaiting seal</td>
                    </tr>
                  ))}
                  {entries.map((e) => {
                    const d = describeEntry(e);
                    return (
                      <tr key={e.hash}>
                        <td>{e.seq}</td>
                        <td>
                          <span className="chip">{d.label}</span>
                        </td>
                        <td>
                          <span>{d.from}</span>
                          <span className="muted"> → </span>
                          <span>{d.to}</span>
                          {d.note && (
                            <div className="muted" style={{ fontSize: '0.8em' }}>
                              {d.note}
                            </div>
                          )}
                        </td>
                        <td>{d.amount}</td>
                        <td className="muted">{shortTime(e.ts)}</td>
                        <td className="mono-hash">{e.hash.slice(0, 12)}…</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
