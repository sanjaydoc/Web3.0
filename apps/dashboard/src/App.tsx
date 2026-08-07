import { useCallback, useEffect, useRef, useState } from 'react';
import { Account } from './Account.js';
import { ConnectMcp } from './ConnectMcp.js';
import { Connectors } from './Connectors.js';
import { Developers } from './Developers.js';
import { Download } from './Download.js';
import { Genesis } from './Genesis.js';
import { GenesisChat } from './GenesisChat.js';
import { HostedDapps } from './HostedDapps.js';
import { Hosting } from './Hosting.js';
import { InstallBanner } from './InstallBanner.js';
import { InstallButton } from './InstallButton.js';
import { Landing } from './Landing.js';
import { LlmTunnel } from './LlmTunnel.js';
import { Marketplace } from './Marketplace.js';
import { Network } from './Network.js';
import { Onboarding } from './Onboarding.js';
import { Operator } from './Operator.js';
import { Skills } from './Skills.js';
import { Telegram } from './Telegram.js';
import { UpdateBanner } from './UpdateBanner.js';
import { Web4 } from './Web4.js';
import {
  type Account as Acct,
  type AgentCard,
  type Guardrails,
  type HostedAgent,
  type LedgerEntry,
  NODE_URL,
  type Reservoir,
  type Stats,
  type Wallet,
  type Web3Event,
  api,
  formatAmount,
  getWeb3Token,
  ratePerHourPrecise,
} from './api.js';
import { uiConfirm } from './dialog.js';

type View =
  | 'overview'
  | 'mynode'
  | 'llmtunnel'
  | 'agents'
  | 'skills'
  | 'network'
  | 'connectors'
  | 'traffic'
  | 'ledger'
  | 'guardrails'
  | 'genesis'
  | 'genesischat'
  | 'connectmcp'
  | 'hosteddapps'
  | 'telegram'
  | 'developers'
  | 'account'
  | 'marketplace'
  | 'agentweb4'
  | 'nodeweb4'
  | 'hosting'
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
  { id: 'nodeweb4', label: 'x402 · ERC-8004', operator: true },
  { id: 'agentweb4', label: 'x402 · ERC-8004', operator: true },
  { id: 'llmtunnel', label: 'Host LLM tunnel', operator: true },
  { id: 'hosting', label: 'Hosting · sell your RAM', operator: true },
  { id: 'network', label: 'Network' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'skills', label: 'Skills' },
  { id: 'ledger', label: 'Payments & ledger', badge: 'entries' },
  { id: 'telegram', label: 'Telegram bot' },
  { id: 'genesis', label: 'Genesis · new agent', operator: true },
  { id: 'genesischat', label: 'Genesis chat', operator: true },
  { id: 'connectmcp', label: 'Connect via MCP', operator: true },
  { id: 'marketplace', label: 'Marketplace', operator: true },
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
const LOCKED_ON_MAIN = new Set<View>([
  'genesis',
  'genesischat',
  'connectmcp',
  'developers',
  'hosteddapps',
  'llmtunnel',
]);

/**
 * Exactly which views each non-admin persona sees (an admin always sees everything). The two are
 * mutually exclusive at signup:
 *  - OPERATOR — runs/earns from a node: a lean host console.
 *  - AGENT_OWNER — creates & manages agents: the builder console.
 * Network + Live traffic (network-wide observability) are in neither list, so they stay admin-only.
 * The OWNER's Genesis/Developers/Hosted dApps are in LOCKED_ON_MAIN, so on the reserved main node an
 * owner can't launch there until they have a host to run on (the marketplace).
 */
const OPERATOR_NAV = new Set<View>([
  'overview',
  'account',
  'download',
  'mynode',
  'llmtunnel',
  'hosting',
  'nodeweb4',
  'ledger',
]);
const AGENT_OWNER_NAV = new Set<View>([
  'overview',
  'account',
  'genesis',
  'genesischat',
  'connectmcp',
  'marketplace',
  'developers',
  'hosteddapps',
  'skills',
  'connectors',
  'ledger',
  'agentweb4',
  'telegram',
  'agents',
  'guardrails',
  // Owners can also spin up their own node when they're ready — the "Run a node" page hands them the
  // installers + setup. (Just the download/get-started front door; the operator earnings console —
  // mynode/llmtunnel — belongs to an operator account they'd run alongside it.)
  'download',
]);
/**
 * The Community ("Free Agents") tier's FIXED nav — exactly the 8 views the free desktop app shows. It
 * reuses the LLM-tunnel and hosting views (relabelled "Your Agent LLM" / "Your Agent RAM"), drops every
 * marketplace-selling + earnings view (community compute is donated free), and — unlike the personas
 * above — overrides even the admin's full console, since a single-user community desktop bootstraps its
 * owner as admin. Order here is the sidebar order (rendered flat, no groups).
 */
const COMMUNITY_NAV: View[] = [
  'overview',
  'account',
  'agentweb4',
  'genesis',
  'agents',
  // Office agents need to connect their Email / Calendar / Google account — the Connectors page hosts
  // those credential cards, so it must be reachable in the Free-Agents nav too (the office template
  // points here). Without it, a community user is told to open a page their nav doesn't show.
  'connectors',
  'llmtunnel',
  'hosting',
  'ledger',
];

/**
 * How the agent-owner sidebar is laid out: a few top-level items, then two titled groups, then
 * Marketplace on its own. A group with no title renders its items flush (no header). Only ids that
 * survive `visibleNav` (main-node locking etc.) are shown, so this is purely presentation order — it
 * never widens access beyond AGENT_OWNER_NAV.
 */
const AGENT_OWNER_GROUPS: { title?: string; items: View[] }[] = [
  { items: ['account', 'overview', 'ledger', 'marketplace'] },
  {
    title: 'Launch agents',
    items: [
      'genesischat',
      'genesis',
      'connectmcp',
      'agentweb4',
      'connectors',
      'skills',
      'telegram',
      'agents',
    ],
  },
  { title: 'Settings', items: ['guardrails', 'developers', 'hosteddapps'] },
  { title: 'Run a node', items: ['download'] },
];

/**
 * How the ADMIN sidebar is laid out: the full console, grouped so it isn't one long flat list.
 * Top-level items first, then collapsible Agents / Node / Network groups. Any NAV id not listed here
 * still renders (appended by the fallback below), so nothing is ever hidden from the admin.
 */
const ADMIN_GROUPS: { title?: string; items: View[] }[] = [
  { items: ['overview', 'account', 'ledger', 'marketplace'] },
  {
    title: 'Agents',
    items: [
      'genesischat',
      'genesis',
      'connectmcp',
      'agents',
      'skills',
      'connectors',
      'telegram',
      'agentweb4',
      'developers',
      'hosteddapps',
    ],
  },
  { title: 'Node', items: ['mynode', 'download', 'llmtunnel', 'hosting', 'nodeweb4'] },
  { title: 'Network', items: ['network', 'traffic', 'guardrails'] },
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
  // Is the node reachable? Polled for EVERYONE (the admin data-poll below is admin-only, so operators
  // would otherwise always read snap.online === false and see a wrong "node offline" in the footer).
  const [nodeOnline, setNodeOnline] = useState(false);
  // Mobile nav drawer: collapses behind a hamburger below 760px, toggled by the top-bar button.
  const [menuOpen, setMenuOpen] = useState(false);
  // Which collapsible sidebar groups (agent-owner nav) are expanded, by title. Starts collapsed;
  // the group holding the current view auto-opens (see effect), so the menu stays short by default.
  const [openNavGroups, setOpenNavGroups] = useState<Set<string>>(() => new Set());
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
  // Community ("Free Agents") tier: true when the connected node runs the Community desktop installer.
  // Drives the reduced nav + the local-Ollama-only Genesis + the preconfigured LLM/RAM contribution
  // views — sourced entirely from the node's own config (GET /node → community), no separate build.
  const [community, setCommunity] = useState(false);
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
          setCommunity(Boolean(n.community?.enabled));
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

  // The account's own hosted agents (Genesis-created, running in this node). Lifted to App level so
  // both the Agents view AND the sidebar "Agents" badge count the SAME owner-scoped set — otherwise
  // the badge (which used the global registry) shows more than the table (scoped to your own).
  const [hosted, setHosted] = useState<HostedAgent[]>([]);
  useEffect(() => {
    if (!authed) return;
    let active = true;
    const load = () =>
      api
        .hosted()
        .then((r) => active && setHosted(r.agents))
        .catch(() => {
          /* node offline / not permitted — leave the last known list */
        });
    load();
    const t = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [authed]);

  // The signed-in account's real role governs access: only an admin account sees admin sections
  // and the Operator/Admin toggle. Operators, developers, and guests are locked to the operator view.
  const isAdmin = account?.role === 'admin';
  // The agent-owner persona (create/own agents, pay a host) sees the builder console; every other
  // non-admin (operator/developer/guest) sees the lean node-operator console. Exclusive at signup.
  const isAgentOwner = account?.role === 'agent-owner';
  const role: Role = isAdmin ? rolePref : 'operator';

  // Agents a non-admin may see: the treasury is admin-only node infrastructure, so drop it from the
  // list (and the nav badge count) for operators. Admins still see it.
  const agentsForView =
    isAdmin || !treasuryId ? snap.agents : snap.agents.filter((a) => a.web3Id !== treasuryId);

  // The "Agents" badge must match the Agents TABLE, which for a non-admin shows only agents this
  // account hosts (the /hosted set, scoped server-side to createdBy). Counting the whole registry
  // here would over-count (e.g. an SDK-registered or another owner's agent still in the directory).
  const ownedHostedIds = new Set(hosted.map((h) => h.web3Id));
  // The owner's identity set for scoping their activity feed: their account address plus every
  // agent they own. An event "involves them" if its actor or target is in this set.
  const ownedIdentity = new Set<string>(ownedHostedIds);
  if (account?.address) ownedIdentity.add(account.address);
  const agentsBadgeCount = isAdmin
    ? agentsForView.length
    : agentsForView.filter((a) => ownedHostedIds.has(a.web3Id)).length;

  // A non-admin on the main node: hosting/publishing here is reserved for the admin, so hide those
  // views and make "Run a node" their home — participation happens on their own node.
  const mainNodeLocked = adminOnly && !isAdmin;
  const operatorHome: View = mainNodeLocked ? 'download' : OPERATOR_HOME;
  // Where each persona lands (and falls back to). An agent-owner's home is Genesis (create an agent);
  // on the reserved main node, where hosting is locked, they fall back to their Account until a host
  // (the marketplace) is available.
  const personaHome: View = community
    ? 'overview'
    : isAgentOwner
      ? mainNodeLocked
        ? 'account'
        : 'genesis'
      : operatorHome;

  // You get the FULL node console (network, ledger, connectors, skills, telegram, …) whenever you
  // run THIS node: an admin on any node, OR any operator on a node that isn't the reserved main node
  // — i.e. their own desktop/self-hosted node. On the admin-only main node an operator stays limited
  // to their personal items. (ownsNode === !mainNodeLocked, named for readability.)
  const ownsNode = !mainNodeLocked;

  const personaNav = isAgentOwner ? AGENT_OWNER_NAV : OPERATOR_NAV;
  // Community ("Free Agents") tier: a FIXED reduced nav in its own sidebar order, overriding even the
  // admin's full console (a community desktop bootstraps its single user as admin). Otherwise, filter
  // to the signed-in persona's views (admin sees everything).
  const visibleNav: typeof NAV = community
    ? (COMMUNITY_NAV.map((id) => NAV.find((n) => n.id === id)).filter(Boolean) as typeof NAV)
    : NAV.filter((n) => {
        // Admin sees the whole console; the Operator/Admin toggle only changes which data is previewed.
        if (isAdmin) return true;
        // Otherwise, exactly the signed-in persona's views.
        if (!personaNav.has(n.id)) return false;
        // Compute/hosting views stay reserved for the admin on the main node; and on the main node a
        // non-admin is limited to their personal (operator-safe) items — participation is on their own node.
        if (mainNodeLocked && (LOCKED_ON_MAIN.has(n.id) || !n.operator)) return false;
        return true;
      });

  // Navigating from the sidebar also closes the mobile drawer so the page is visible.
  const navigate = (v: View) => {
    setView(v);
    setMenuOpen(false);
  };

  // Expand/collapse a titled sidebar group (agent-owner nav).
  const toggleNavGroup = (title: string) =>
    setOpenNavGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  // The grouped sidebar layout for this persona (agent-owner or admin); operators stay flat.
  const navGroups = community
    ? null
    : isAgentOwner
      ? AGENT_OWNER_GROUPS
      : isAdmin
        ? ADMIN_GROUPS
        : null;
  // The titled group that holds the current view (so we can keep it open while it's active).
  const activeGroupTitle = navGroups?.find((g) => g.title && g.items.includes(view))?.title;
  // Auto-open the group of whatever view is active, so the current page's nav item is always visible.
  useEffect(() => {
    if (!activeGroupTitle) return;
    setOpenNavGroups((prev) =>
      prev.has(activeGroupTitle) ? prev : new Set(prev).add(activeGroupTitle),
    );
  }, [activeGroupTitle]);

  // One sidebar entry — shared by the flat (admin/operator) and grouped (agent-owner) layouts.
  const renderNavItem = (n: (typeof NAV)[number]) => (
    <NavItem
      key={n.id}
      id={n.id}
      // Community relabels: the tunnel + hosting views are the user's OWN donated brain/RAM here.
      // For the agent-owner, telegram is their own Telegram-fronted agent, not the node's bot config.
      label={
        community && n.id === 'llmtunnel'
          ? 'Your Agent LLM'
          : community && n.id === 'hosting'
            ? 'Your Agent RAM'
            : isAgentOwner && n.id === 'telegram'
              ? 'Telegram agent'
              : n.label
      }
      view={view}
      set={navigate}
      count={
        n.badge === 'agents'
          ? agentsBadgeCount
          : n.badge === 'events'
            ? snap.events.length
            : n.badge === 'entries'
              ? snap.entries.length
              : undefined
      }
    />
  );

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
    // Community mode enforces its fixed nav even for the (bootstrapped-admin) community user.
    if (isAdmin && !community) return;
    if (!visibleNav.some((n) => n.id === view)) setView(personaHome);
  }, [visibleKey, view, personaHome, isAdmin, community]);

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
  // Community ("Free Agents") nodes SKIP this wizard entirely: the contribution is preconfigured (no RAM
  // step to set) and ANY account type may run one, so an unauthed user drops straight to the sign-in
  // (Landing) and an authed one into the community console.
  if (!community && ((nodeOnline && !onboarded && !isAdmin) || forceOnboard)) {
    return (
      <>
        <InstallBanner />
        <UpdateBanner />
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
        <UpdateBanner />
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

  return (
    <div className={`app ${menuOpen ? 'menu-open' : ''}`}>
      <InstallBanner />
      <UpdateBanner />
      <header className="topbar">
        <button
          type="button"
          className="hamburger"
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="brand">
          <span className="badge">W</span> Web4.0
        </div>
      </header>
      {menuOpen && (
        <div
          className="scrim"
          role="button"
          tabIndex={0}
          aria-label="Close navigation menu"
          onClick={() => setMenuOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') setMenuOpen(false);
          }}
        />
      )}
      <aside className={`side ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="badge">W</span> Web4.0
        </div>
        <p className="tagline">the agentic internet · console</p>
        {isAdmin && !community && (
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
        {navGroups ? (
          // Grouped layout (agent-owner + admin): top-level items render flush; titled groups are
          // collapsible. Each group only shows ids that survived visibleNav. A trailing fallback
          // renders any visible item not placed in a group, so nothing is ever hidden.
          <>
            {navGroups.map((group) => {
              const items = group.items
                .map((id) => visibleNav.find((n) => n.id === id))
                .filter((n): n is (typeof NAV)[number] => n !== undefined);
              if (items.length === 0) return null;
              if (!group.title) {
                return (
                  <div className="nav-group" key={`top-${items[0].id}`}>
                    {items.map((n) => renderNavItem(n))}
                  </div>
                );
              }
              const open = openNavGroups.has(group.title);
              return (
                <div className="nav-group" key={group.title}>
                  <button
                    type="button"
                    className={`nav-group-toggle ${open ? 'open' : ''}`}
                    aria-expanded={open}
                    onClick={() => group.title && toggleNavGroup(group.title)}
                  >
                    <span>{group.title}</span>
                    <span className="nav-caret" aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                  </button>
                  {open && items.map((n) => renderNavItem(n))}
                </div>
              );
            })}
            {(() => {
              const grouped = new Set(navGroups.flatMap((g) => g.items));
              const rest = visibleNav.filter((n) => !grouped.has(n.id));
              return rest.length ? (
                <div className="nav-group">{rest.map((n) => renderNavItem(n))}</div>
              ) : null;
            })()}
          </>
        ) : (
          visibleNav.map((n) => renderNavItem(n))
        )}
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
        {view === 'overview' && (
          <Overview
            snap={snap}
            // ANY non-admin (node operator OR agent owner) gets an Overview scoped to THEIR OWN
            // agents + ledger — never the network-wide aggregates (Nodes online, Value in network,
            // Total agents) or other owners' activity, which are admin/node data. Only the admin
            // (sanjay@web4) sees the network view. Regression: a plain operator was getting
            // scope=undefined → the full-network Overview leaked to them (29 agents, network value,
            // other owners' erc8004 registrations). Numbers come from the same owner-scoped sources
            // the rest of their console uses: `hosted` (server-scoped to createdBy), its `.running`
            // flag, and the already-account-scoped ledger entries; recent activity is filtered to
            // events touching the account's own identity — its address or one of its agents.
            scope={
              !isAdmin
                ? {
                    totalAgents: hosted.length,
                    agents: agentsBadgeCount,
                    online: hosted.filter((h) => h.running).length,
                    ledgerEntries: snap.entries.length,
                    events: snap.events.filter((e) => eventInvolves(e, ownedIdentity)),
                  }
                : undefined
            }
          />
        )}
        {view === 'mynode' && <Operator />}
        {view === 'llmtunnel' && <LlmTunnel community={community} />}
        {view === 'hosting' && <Hosting community={community} />}
        {view === 'agents' && (
          <Agents
            agents={agentsForView}
            wallets={snap.wallets}
            ownedOnly={!isAdmin}
            hosted={hosted}
            setHosted={setHosted}
          />
        )}
        {view === 'skills' && (
          // A non-admin sees only their OWN agents' skills here (plus the catalogue skills they
          // registered, scoped server-side) — not every other operator's. Admins see the network.
          <Skills
            agents={
              isAdmin ? agentsForView : agentsForView.filter((a) => ownedHostedIds.has(a.web3Id))
            }
          />
        )}
        {view === 'network' && <Network />}
        {view === 'connectors' && <Connectors go={(v) => setView(v as View)} />}
        {view === 'traffic' && <Traffic events={snap.events} />}
        {view === 'ledger' && (
          <LedgerView snap={snap} admin={isAdmin} me={account?.address ?? null} />
        )}
        {view === 'guardrails' && <GuardrailsView snap={snap} />}
        {view === 'genesis' && <Genesis community={community} />}
        {view === 'genesischat' && (
          // key + account scope the chat transcript to the signed-in account so a shared browser
          // doesn't leak one user's history to the next; key remounts it cleanly on account switch.
          <GenesisChat
            key={account?.address ?? 'anon'}
            account={account?.address ?? null}
            isAdmin={isAdmin}
          />
        )}
        {view === 'connectmcp' && <ConnectMcp />}
        {view === 'marketplace' && <Marketplace go={(v) => setView(v as View)} />}
        {view === 'hosteddapps' && <HostedDapps admin={role === 'admin'} />}
        {view === 'developers' && <Developers />}
        {view === 'account' && <Account />}
        {view === 'nodeweb4' && <Web4 scope="node" />}
        {view === 'agentweb4' && <Web4 scope="agent" isAdmin={isAdmin} />}
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
    <div className="card" style={{ marginBottom: 18, borderLeft: '3px solid var(--accent)' }}>
      <div className="section-title">This is the network's main node</div>
      <p className="muted" style={{ margin: '2px 0 12px' }}>
        The main node is reserved for its admin. You can sign up, hold a wallet, and read the
        network here — but to <b>launch agents</b> and <b>earn USDC</b> for the compute you
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

/** Owner-scoped Overview figures — an agent-owner's own agents + ledger, not the network totals. */
interface OverviewScope {
  totalAgents: number;
  agents: number;
  online: number;
  ledgerEntries: number;
  /** Recent-activity events already filtered to the owner's own identity. */
  events: Web3Event[];
}

/** An event "involves" the owner when its actor or target is in their identity set. */
function eventInvolves(e: Web3Event, ids: Set<string>): boolean {
  return (
    (e.actor !== undefined && ids.has(e.actor)) || (e.target !== undefined && ids.has(e.target))
  );
}

function Overview({ snap, scope }: { snap: Snapshot; scope?: OverviewScope }) {
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
        {scope ? (
          // Agent-owner: only their own numbers. No node/network aggregates (Nodes online, Value in
          // network) — those are admin-panel data and don't belong on a builder's dashboard.
          <>
            <Stat k="Total agents" n={String(scope.totalAgents)} />
            <Stat k="Agents" n={String(scope.agents)} />
            <Stat k="Agents online" n={String(scope.online)} />
            <Stat k="Ledger entries" n={String(scope.ledgerEntries)} />
            <Stat k="Ledger integrity" n={snap.ledgerVerified ? 'verified' : 'BROKEN'} />
          </>
        ) : (
          <>
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
              unit={s ? 'USDC' : undefined}
            />
            <Stat k="Ledger entries" n={s ? String(s.ledgerEntries) : '—'} />
            <Stat k="Ledger integrity" n={snap.ledgerVerified ? 'verified' : 'BROKEN'} />
          </>
        )}
      </div>
      <div className="section-title">Recent activity</div>
      <div className="card">
        <Feed events={(scope ? scope.events : snap.events).slice(0, 12)} />
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

function Agents({
  agents,
  wallets,
  ownedOnly,
  hosted,
  setHosted,
}: {
  agents: AgentCard[];
  wallets: Wallet[];
  ownedOnly: boolean;
  hosted: HostedAgent[];
  setHosted: (a: HostedAgent[]) => void;
}) {
  const balanceOf = (id: string) => wallets.find((w) => w.owner === id)?.balance ?? 0;

  // Hosted agents (Genesis-created, running IN this node) are the ones we can start/stop/delete. The
  // list is fetched at App level and shared with the sidebar badge; the node returns only the caller's
  // own hosted agents to a non-admin, so the controls appear only on rows the operator owns.
  const [busy, setBusy] = useState<string | null>(null);
  const [chatWith, setChatWith] = useState<HostedAgent | null>(null);
  const [copiedId, setCopiedId] = useState(''); // web3Id whose endpoint was just copied (button feedback)
  // RAM Reservoir: the global rate a placed agent is billed at, shown live next to its host.
  const [reservoir, setReservoir] = useState<Reservoir | null>(null);
  useEffect(() => {
    let on = true;
    const pull = () =>
      api
        .reservoir()
        .then((r) => on && setReservoir(r))
        .catch(() => {});
    pull();
    const t = setInterval(pull, 10_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, []);
  const hostedById = new Map(hosted.map((h) => [h.web3Id, h]));
  // An agent owner sees only THEIR OWN agents here (the ones this node reports as hosted-by-them);
  // admins see the whole registry. Stops other owners' agents leaking into a personal Agents view.
  const visible = ownedOnly ? agents.filter((a) => hostedById.has(a.web3Id)) : agents;

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

  // Rent is authorized automatically: a placed agent's per-epoch rent bills straight from the owner's
  // balance (billEpoch settles un-mandated leases), so agent owners don't set up or sign anything to
  // keep their agents hosted. (The optional signed lease-mandate flow was removed — it added setup
  // friction with no benefit under the admin-priced RAM Reservoir, where the global rate is the cap.)

  const remove = async (h: HostedAgent) => {
    if (
      !(await uiConfirm(`Delete agent "${h.handle}"? This can't be undone.`, {
        title: 'Delete agent',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    setBusy(h.web3Id);
    try {
      const r = await api.hostedDelete(h.handle);
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
        {visible.length === 0 ? (
          <div className="empty">
            {ownedOnly
              ? "You haven't created any agents yet. Head to Genesis to launch one."
              : 'No agents registered yet. Run the two-agents demo.'}
          </div>
        ) : (
          // Scroll wrapper: the columns overflow a phone's width; scroll inside the card instead of
          // the last columns bleeding past the edge. (Agents view only.)
          <div className="hscroll">
            <table>
              <thead>
                <tr>
                  <th>Web4.0 ID</th>
                  <th>Control</th>
                  <th>Runs on</th>
                  <th>Kind</th>
                  <th>Skills</th>
                  <th>Wallet</th>
                  <th>DID</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => {
                  const h = hostedById.get(a.web3Id);
                  return (
                    <tr key={a.web3Id}>
                      <td>
                        <strong>{a.web3Id}</strong>
                      </td>
                      <td>
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          {/* Copy the agent's callable endpoint — drops straight into an app/workflow.
                              Priced agents → their x402 (pay-per-call) URL; free → the public /ask URL. */}
                          <button
                            type="button"
                            className="btn ghost btn-sm"
                            title={
                              (a.pricing?.perTask ?? 0) > 0
                                ? "Copy this agent's paid (x402) endpoint"
                                : "Copy this agent's public endpoint — POST a question, get an answer"
                            }
                            onClick={() => {
                              const perTask = a.pricing?.perTask ?? 0;
                              const skillId = a.skills[0]?.id ?? 'ask';
                              const url =
                                perTask > 0
                                  ? `${NODE_URL}/x402/call/${a.web3Id}/${skillId}`
                                  : `${NODE_URL}/agents/${a.web3Id}/ask`;
                              navigator.clipboard?.writeText(url);
                              setCopiedId(a.web3Id);
                              setTimeout(() => setCopiedId(''), 1500);
                            }}
                          >
                            {copiedId === a.web3Id
                              ? 'Copied'
                              : (a.pricing?.perTask ?? 0) > 0
                                ? 'Copy paid endpoint'
                                : 'Copy endpoint'}
                          </button>
                          {h && (
                            <>
                              <button
                                type="button"
                                className={`btn-run ${h.running ? 'btn-stop' : 'btn-start'}`}
                                disabled={busy === a.web3Id}
                                onClick={() => toggle(h)}
                              >
                                {busy === a.web3Id ? '…' : h.running ? 'Stop' : 'Start'}
                              </button>
                              {h.running && (
                                <button
                                  type="button"
                                  className="btn act"
                                  style={{ padding: '4px 10px' }}
                                  onClick={() => setChatWith(h)}
                                  title="Chat with this agent to test it"
                                >
                                  Test
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        {/* RAM economy: where this agent's body actually runs. */}
                        {!h ? (
                          <span
                            className="muted"
                            title="Runs off this node — an external agent connected from its owner's own machine via the SDK/script"
                          >
                            external
                          </span>
                        ) : !h.placement || h.placement === 'local' ? (
                          <span className="muted">this node</span>
                        ) : h.placement === 'pending' ? (
                          <span
                            className="chip"
                            title="No node operator is selling RAM right now — the network keeps searching and places it the moment one comes online"
                          >
                            waiting for a node operator
                          </span>
                        ) : h.placement === 'stopped' ? (
                          <span
                            className="muted"
                            title="You stopped this agent — start it to place it again"
                          >
                            stopped
                          </span>
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              gap: 6,
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span
                              className="chip allow"
                              title={`Body placed on operator ${h.placement}`}
                            >
                              operator{' '}
                              {h.placement.length > 12
                                ? `${h.placement.slice(0, 8)}…`
                                : h.placement}
                            </span>
                            {reservoir && reservoir.price.perGbHour > 0 && (
                              <span
                                className="muted"
                                style={{ fontSize: 11 }}
                                title="Network RAM rate this agent is billed"
                              >
                                {ratePerHourPrecise(
                                  reservoir.price.perAgentEpoch,
                                  reservoir.price.epochMs,
                                )}
                              </span>
                            )}
                          </div>
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
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {h && (
                          <button
                            type="button"
                            className="btn-delete"
                            disabled={busy === a.web3Id}
                            onClick={() => remove(h)}
                            title="Delete this agent"
                            aria-label={`Delete ${h.handle}`}
                          >
                            {busy === a.web3Id ? '…' : 'Delete'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {chatWith && <AgentChat agent={chatWith} onClose={() => setChatWith(null)} />}
    </>
  );
}

/** A simple chat panel to test a hosted agent — sends each message to the agent and shows its reply. */
function AgentChat({ agent, onClose }: { agent: HostedAgent; onClose: () => void }) {
  const [msgs, setMsgs] = useState<{ id: number; role: 'you' | 'agent'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to newest whenever the log grows
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [msgs.length]);

  const push = (role: 'you' | 'agent', text: string) =>
    setMsgs((m) => [...m, { id: nextId.current++, role, text }]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    push('you', q);
    setInput('');
    setBusy(true);
    try {
      const { output } = await api.askHosted(agent.handle, q);
      const text =
        typeof output.answer === 'string'
          ? output.answer
          : typeof output.error === 'string'
            ? `${output.error}`
            : JSON.stringify(output, null, 2);
      push('agent', text);
    } catch (e) {
      push('agent', `${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div
        className="section-title"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span>
          Test · {agent.web3Id}{' '}
          <span className="muted">
            ({agent.provider}/{agent.model})
          </span>
        </span>
        <button type="button" className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div
        ref={feedRef}
        style={{
          maxHeight: 340,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          margin: '10px 0',
        }}
      >
        {msgs.length === 0 && (
          <div className="muted">Ask your agent something to test its brain and connectors…</div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`gchat-msg ${m.role === 'you' ? 'gchat-user' : 'gchat-bot'}`}>
            <div className="gchat-bubble">{m.text}</div>
          </div>
        ))}
        {busy && (
          <div className="gchat-msg gchat-bot">
            <div className="gchat-bubble gchat-typing" aria-label="Agent is thinking">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1 }}
          value={input}
          placeholder="Ask your agent something…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <button type="button" className="btn act" disabled={busy} onClick={send}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
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
 * opaque "payment / <hash>" rows into an auditable payments table: a transfer to sanjay@web4
 * reads as `you → sanjay@web4 · 5.00 USDC`, a faucet/reward as a `mint`.
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
  const cur = str(d.currency) || 'USDC';
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
                    <th>No</th>
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
