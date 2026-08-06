import { useCallback, useEffect, useState } from 'react';
import {
  type HostingSummary,
  NODE_URL,
  type Reservoir,
  api,
  formatAmount,
  formatGbHourPrice,
  ratePerHour,
  ratePerHourPrecise,
} from './api.js';

// Hosting agent bodies runs on the operator's OWN machine (its contributed RAM), so — like the LLM
// tunnel — this section is only meaningful when the dashboard drives a LOCAL node (desktop/mobile).
// On the website the dashboard talks to a shared node, so hosting is shown disabled.
const IS_NATIVE_HOST =
  typeof window !== 'undefined' &&
  (Boolean((window as { web3desktop?: unknown }).web3desktop) ||
    NODE_URL.includes('127.0.0.1') ||
    NODE_URL.includes('localhost'));

const shortKey = (k: string) => (k.length > 14 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k);

const ADMIN_KEY = 'web3.adminToken';

/**
 * Contribution — how much of THIS machine the operator lends to the network (RAM → hosting slots,
 * max agents, whether to host others at all). Lives here on the Hosting page (not "My node earnings")
 * because it's the input side of selling RAM: what you contribute here sets the capacity shown below.
 */
// Community ("Free Agents") free-agent cap from contributed hosting RAM: 1 GB = 1 free agent
// (floor(ramGb), min 1, clamped to 129) — mirrors the node's communityAgentCap so the dial preview
// matches what the node enforces. The rest of the contributed RAM is surplus sold to the paid reservoir.
const communityAgents = (gb: number) => Math.min(129, Math.max(1, Math.floor(gb)));

function Contribution({ community = false }: { community?: boolean }) {
  const [contribute, setContribute] = useState(true);
  const [maxRamGb, setMaxRamGb] = useState('0');
  const [maxAgents, setMaxAgents] = useState('0');
  // Community dial state: current contributed GB + the dial's floor/ceiling (from the node).
  const [commGb, setCommGb] = useState(2);
  const [commMinGb, setCommMinGb] = useState(2);
  const [commMaxGb, setCommMaxGb] = useState(128);
  const [commSaving, setCommSaving] = useState(false);
  const [commMsg, setCommMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [admin, setAdmin] = useState(() =>
    typeof localStorage !== 'undefined' ? (localStorage.getItem(ADMIN_KEY) ?? '') : '',
  );
  const [adminReq, setAdminReq] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [touched, setTouched] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const n = await api.node();
      if (!touched) {
        setContribute(n.limits.contribute);
        setMaxRamGb((n.limits.maxRamMb / 1024).toFixed(1).replace(/\.0$/, ''));
        setMaxAgents(String(n.limits.maxAgents));
      }
      // Community: sync the dial to the node's live contributed RAM + its floor/ceiling.
      const c = n.community;
      if (c?.enabled) {
        setCommMinGb(Math.round((c.minRamMb ?? 2048) / 1024));
        setCommMaxGb(Math.round((c.maxRamMb ?? 131072) / 1024));
        if (!touched) setCommGb(Math.max(2, Math.round((c.ramMb ?? 2048) / 1024)));
      }
    } catch {
      /* offline — keep last */
    }
    api
      .telegram()
      .then((t) => setAdminReq(t.adminRequired))
      .catch(() => undefined);
  }, [touched]);

  useEffect(() => {
    if (!IS_NATIVE_HOST) return;
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const rememberAdmin = (v: string) => {
    setAdmin(v);
    if (typeof localStorage !== 'undefined') localStorage.setItem(ADMIN_KEY, v);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.nodeLimits(
        {
          contribute,
          maxRamMb: Math.round(Number.parseFloat(maxRamGb || '0') * 1024),
          maxAgents: Math.max(0, Math.round(Number.parseFloat(maxAgents || '0'))),
        },
        admin,
      );
      setMsg({ kind: 'ok', text: 'Contribution saved.' });
      setTouched(false);
      refresh();
      // Changing contributed RAM may unlock a new local-model tier — kick a background re-pull.
      (window as unknown as { web3desktop?: { ensureModel?: () => Promise<unknown> } }).web3desktop
        ?.ensureModel?.()
        .catch(() => undefined);
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  // Community ("Free Agents") tier: the contribution is USER-ADJUSTABLE via a dial (2 → 128 GB), all
  // donated FREE to the reservoir. Each GB unlocks 1 free agent above the 3-agent base — so moving the
  // dial changes how many agents you can create in Genesis. Saved via POST /node/limits (no admin token).
  const saveCommunityRam = async () => {
    setCommSaving(true);
    setCommMsg(null);
    try {
      await api.nodeLimits({ contribute: true, maxRamMb: Math.round(commGb * 1024) });
      setCommMsg({ kind: 'ok', text: 'Contribution updated.' });
      setTouched(false);
      // A bigger contribution may unlock a bigger local-model tier — nudge a re-pull.
      (window as unknown as { web3desktop?: { ensureModel?: () => Promise<unknown> } }).web3desktop
        ?.ensureModel?.()
        .catch(() => undefined);
    } catch (err) {
      setCommMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setCommSaving(false);
    }
  };

  if (community) {
    const agents = communityAgents(commGb);
    const ownMb = agents * 300; // each free agent is budgeted ≤300 MB…
    const reservoirMb = Math.max(0, commGb * 1024 - ownMb); // …the rest is donated to the reservoir.
    return (
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Your Agent RAM</div>
        <p className="muted" style={{ margin: '2px 0 12px' }}>
          Dial how much RAM you donate to the shared network — all of it <b>free</b>. Every GB above
          the 2 GB base unlocks <b>one more free agent</b> to create. Each agent is budgeted ≤300
          MB; the rest of your contribution feeds the RAM Reservoir that hosts other people's
          agents.
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '2px 0 8px' }}>
          <span style={{ fontSize: 28, fontWeight: 700 }}>{commGb} GB</span>
          <span className="muted">
            → <b>{agents}</b> free agent{agents === 1 ? '' : 's'}
          </span>
        </div>
        <input
          type="range"
          min={commMinGb}
          max={commMaxGb}
          step={1}
          value={commGb}
          onChange={(e) => {
            setCommGb(Number(e.target.value));
            setTouched(true);
          }}
          style={{ width: '100%' }}
        />
        <div
          className="muted"
          style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 2 }}
        >
          <span>{commMinGb} GB · 3 agents</span>
          <span>
            {commMaxGb} GB · {communityAgents(commMaxGb)} agents
          </span>
        </div>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>Free agents unlocked</dt>
          <dd>{agents}</dd>
          <dt>Your agents' budget</dt>
          <dd>
            ≤ {(ownMb / 1024).toFixed(1)} GB ({agents} × 300 MB)
          </dd>
          <dt>Donated to reservoir</dt>
          <dd>≈ {(reservoirMb / 1024).toFixed(1)} GB (hosts others, free)</dd>
        </dl>
        <div className="gen-actions">
          <button
            type="button"
            className="btn act"
            disabled={commSaving}
            onClick={saveCommunityRam}
          >
            {commSaving ? 'Saving…' : 'Save contribution'}
          </button>
        </div>
        {commMsg && (
          <div className={`note ${commMsg.kind === 'err' ? 'note-err' : 'note-ok'}`}>
            {commMsg.text}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="section-title">Contribution</div>
      <p className="muted" style={{ margin: '2px 0 12px' }}>
        Choose how much of this machine you lend to the network. Limits are enforced — the node
        won't host past your caps.
      </p>
      {adminReq && (
        <div className="field wide">
          <label htmlFor="h-admin">Admin token</label>
          <input
            id="h-admin"
            type="password"
            value={admin}
            onChange={(ev) => rememberAdmin(ev.target.value)}
            placeholder="required to change limits"
          />
        </div>
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="h-ram">Max RAM to contribute (GB)</label>
          <input
            id="h-ram"
            value={maxRamGb}
            onChange={(ev) => {
              setMaxRamGb(ev.target.value);
              setTouched(true);
            }}
          />
          <span className="hint">0 = no cap</span>
        </div>
        <div className="field">
          <label htmlFor="h-agents">Max agents to host</label>
          <input
            id="h-agents"
            value={maxAgents}
            onChange={(ev) => {
              setMaxAgents(ev.target.value);
              setTouched(true);
            }}
          />
          <span className="hint">0 = no cap</span>
        </div>
        <div className="field">
          <label htmlFor="h-contrib">Offer spare compute</label>
          <select
            id="h-contrib"
            value={contribute ? 'yes' : 'no'}
            onChange={(ev) => {
              setContribute(ev.target.value === 'yes');
              setTouched(true);
            }}
          >
            <option value="yes">Yes — host others' agents</option>
            <option value="no">No — my agents only</option>
          </select>
        </div>
      </div>
      <div className="gen-actions">
        <button type="button" className="btn act" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save contribution'}
        </button>
      </div>
      {msg && (
        <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
      )}
    </div>
  );
}

/**
 * Hosting · sell your RAM — the node operator's section for the RAM economy (the body counterpart to
 * "Host LLM tunnel", which sells the brain). It shows how much agent-hosting capacity this machine
 * contributes (slots derived from its RAM), how much is free, and every agent body it's currently
 * running FOR OTHER owners — the RAM it's selling. Per-epoch rent lands in R2; R1 surfaces capacity
 * and the hosted bodies so an operator can see their machine earning its keep.
 */
export function Hosting({ community = false }: { community?: boolean } = {}) {
  const [summary, setSummary] = useState<HostingSummary | null>(null);
  const [revenue, setRevenue] = useState(0);
  const [price, setPrice] = useState<number | null>(null); // the operator's set per-epoch rent price
  const [priceInput, setPriceInput] = useState('');
  // The payout account recorded in this node's hosting offer. Rent can only be billed to a host with
  // an account on file (see openLease); in reservoir mode the price control is hidden, so we record it
  // automatically (below) — otherwise a reservoir operator hosts bodies but earns nothing.
  const [offerHost, setOfferHost] = useState<string | null>(null);
  const [autoRegistered, setAutoRegistered] = useState(false);
  const [endpoint, setEndpoint] = useState(''); // the operator's advertised public endpoint (opt-in)
  const [endpointInput, setEndpointInput] = useState('');
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [net, setNet] = useState<{ operators: number; freeSlots: number } | null>(null);
  // RAM Reservoir: the admin-set global rate the pool bills (when on) — what this operator earns from.
  const [reservoir, setReservoir] = useState<Reservoir | null>(null);
  // Epoch duration (ms) so rent shows as a human /hour rate (billing stays per-epoch under the hood).
  const [epochMs, setEpochMs] = useState(0);
  // Ledger-derived hosting income + hosted agents — correct on ANY node the dashboard connects to
  // (the lease list lives only on the owner's node; the ledger is replicated everywhere).
  const [earned, setEarned] = useState<{
    total: number;
    agents: { agentId: string; owner: string; total: number; payments: number; since: number }[];
  } | null>(null);

  const load = useCallback(async () => {
    // Fetch each independently — a failure in one (e.g. /hosted/hosting) must NOT drop the others.
    // "Agents you're hosting" is driven by `earned` (the shared ledger), so it has to render on its
    // own regardless of whether the capacity/offer/network calls succeed.
    const [s, rev, offer, network, earn, ep, pool] = await Promise.all([
      api.hostingSummary().catch(() => null),
      api.hostingRevenue().catch(() => null),
      api.hostingOffer().catch(() => null),
      api.hostingNetwork().catch(() => null),
      api.hostingEarned().catch(() => null),
      api.hostingEndpoint().catch(() => null),
      api.reservoir().catch(() => null),
    ]);
    if (s) setSummary(s);
    if (rev) setRevenue(rev.revenue);
    if (earn) setEarned(earn);
    if (offer) {
      setPrice(offer.pricePerEpoch);
      setOfferHost(offer.host);
    }
    if (ep) setEndpoint(ep.endpoint);
    if (pool) setReservoir(pool);
    if (network) {
      setNet(network.totals);
      setEpochMs(network.epochMs || 0);
    }
  }, []);

  const savePrice = async () => {
    const p = Math.max(0, Math.round(Number(priceInput)));
    if (!Number.isFinite(p)) {
      setMsg({ kind: 'err', text: 'Enter a whole number of USDC minor units.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await api.setHostingOffer(p);
      setPrice(p);
      setPriceInput('');
      setMsg({ kind: 'ok', text: 'Rent price updated.' });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  // Save (or clear, with an empty field) the operator's advertised public endpoint. It rides this
  // node's signed heartbeat and shows to renters in "Your rentals"; unset stays "relay-only".
  const saveEndpoint = async () => {
    setSavingEndpoint(true);
    setMsg(null);
    try {
      const res = await api.setHostingEndpoint(endpointInput.trim());
      setEndpoint(res.endpoint);
      setEndpointInput('');
      setMsg({
        kind: 'ok',
        text: res.endpoint ? 'Public endpoint updated.' : 'Public endpoint cleared (relay-only).',
      });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSavingEndpoint(false);
    }
  };

  useEffect(() => {
    if (!IS_NATIVE_HOST) return; // don't poll a shared node's data on the website
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Reservoir payout auto-registration. Under the RAM Reservoir the per-operator price control is
  // hidden (one admin-set global rate applies), so a fresh operator never publishes an offer — which
  // means its payout account is never recorded, and `openLease` (owner side) can't bill rent to a host
  // with no account. Here we publish a zero-price offer once, purely to record THIS operator's account
  // as the payee, so placed bodies start accruing rent at the reservoir rate. No-op when an account is
  // already on file, when the reservoir is off (the operator sets a price manually), or off-device.
  useEffect(() => {
    if (!IS_NATIVE_HOST || autoRegistered) return;
    const reservoirOn = !!reservoir && reservoir.price.perGbHour > 0;
    const hasCapacity = !!summary?.capacity && summary.capacity.cap > 0;
    if (!reservoirOn || !hasCapacity || offerHost) return;
    setAutoRegistered(true); // guard against re-firing while the POST + reload is in flight
    api
      .setHostingOffer(0)
      .then(() => load())
      .catch(() => setAutoRegistered(false)); // let it retry on a transient failure
  }, [reservoir, summary, offerHost, autoRegistered, load]);

  const cap = summary?.capacity;
  const capacityLabel =
    cap == null
      ? '—'
      : cap.cap > 0
        ? `${cap.used} / ${cap.cap} slots used`
        : 'not contributing RAM yet';
  const freeLabel = cap == null ? '—' : cap.free === null ? 'unlimited' : `${cap.free} slots free`;
  const hosted = summary?.hosted ?? [];
  // "Who am I hosting + earning" unions TWO sources so a row shows if EITHER is true:
  //   • the shared ledger (earned.agents) — rent income, correct on any node; and
  //   • the local bodies this node physically runs for others (summary.hosted) — live model/status.
  // Neither alone is complete: a freshly-placed body earns nothing yet (ledger empty), and a node that
  // only seeds/relays sees rent on the ledger without running the body. Keyed by agentId (web3Id).
  const earnedTotal = earned?.total ?? revenue;
  const byId = new Map<
    string,
    {
      agentId: string;
      name: string;
      owner: string;
      model?: string;
      running?: boolean;
      hasLocal: boolean;
      earned: number;
      payments: number;
      /** When this rental started (ms): ledger's earliest hosting-fee, else the local body's createdAt. */
      since: number;
    }
  >();
  // Live bodies this node physically runs for others = the authoritative "currently hosting" set. Build
  // from these FIRST so the list reflects what's actually running now, not stale ledger history.
  for (const h of hosted) {
    const created = Date.parse(h.createdAt);
    byId.set(h.web3Id, {
      agentId: h.web3Id,
      name: h.name || h.handle || h.web3Id,
      owner: h.hostedForOwner || h.createdBy,
      model: h.model,
      running: h.running,
      hasLocal: true,
      earned: 0,
      payments: 0,
      since: Number.isFinite(created) ? created : 0,
    });
  }
  // Ledger-derived rent income (append-only, so it INCLUDES agents that were since stopped/deleted).
  // Attach earnings onto a live row when we have one; only add a ledger-ONLY row when this dashboard is
  // NOT the physical host — a seed/relay node legitimately shows rent for a body that lives elsewhere.
  // On the operator's OWN machine a ledger-only agent has no live body here (it was switched off or
  // deleted), so it must NOT appear as "currently hosting" or occupy a slot.
  for (const e of earned?.agents ?? []) {
    const row = byId.get(e.agentId);
    if (row) {
      row.earned = e.total;
      row.payments = e.payments;
      if (!row.since) row.since = e.since ?? 0;
    } else if (!IS_NATIVE_HOST) {
      byId.set(e.agentId, {
        agentId: e.agentId,
        name: e.agentId,
        owner: e.owner,
        hasLocal: false,
        earned: e.total,
        payments: e.payments,
        since: e.since ?? 0,
      });
    }
  }
  // Most recent rental on top (largest `since`), tie-broken by rent earned.
  const hostRows = [...byId.values()].sort((a, b) => b.since - a.since || b.earned - a.earned);
  // Slots this node is selling right now = live bodies actually RUNNING for others (a switched-off or
  // removed body frees its slot, so it isn't counted). Matches the backend capacity `used`.
  const activeHostedCount = hosted.filter((h) => h.running).length;

  return (
    <>
      <div className="page-head">
        <h1>Hosting · sell your RAM</h1>
        <span className="muted">run other people's agents on your machine and earn</span>
      </div>

      {!IS_NATIVE_HOST && (
        <div className="card" style={{ marginBottom: 18, borderLeft: '3px solid var(--no)' }}>
          <div className="section-title">Available in the desktop &amp; mobile app</div>
          <p className="muted" style={{ margin: '2px 0 12px' }}>
            Hosting agents runs on <b>your own machine's RAM</b>. The website is connected to a
            shared network node, so hosting is disabled here — it can't reach your computer. Open
            the Web4.0 <b>desktop</b> (or mobile) app to contribute RAM and earn.
          </p>
          <a
            className="btn act"
            href="https://github.com/sanjaydoc/Web4.0/releases/latest"
            target="_blank"
            rel="noreferrer"
          >
            Get the desktop app →
          </a>
        </div>
      )}

      <div
        style={
          IS_NATIVE_HOST
            ? undefined
            : { opacity: 0.4, pointerEvents: 'none', userSelect: 'none', filter: 'grayscale(0.4)' }
        }
        aria-disabled={!IS_NATIVE_HOST}
      >
        <Contribution community={community} />

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="section-title">Your hosting capacity</div>
          <p className="muted" style={{ margin: '2px 0 12px' }}>
            {community ? (
              <>
                Your fixed <b>2 GB</b> contribution becomes agent-hosting slots that the network
                fills with other people's agents — shared <b>for free</b>. This is a contribution
                meter: how many slots you're lending and how many are in use. You earn nothing for
                hosting them and nothing is charged.
              </>
            ) : (
              <>
                Your contributed RAM becomes agent-hosting slots. Agent owners with no node of their
                own pay to run their agents on operators like you — the network auto-places their
                bodies onto whichever operator has a free slot. Set your contributed RAM in the{' '}
                <b>Run a node</b> quick-setup; more RAM = more slots = more you can earn.
              </>
            )}
          </p>
          <dl className="kv">
            <dt>Capacity</dt>
            <dd>{capacityLabel}</dd>
            <dt>Free</dt>
            <dd>{freeLabel}</dd>
            <dt>Hosting for others</dt>
            <dd>{activeHostedCount}</dd>
            {community ? null : reservoir && reservoir.price.perGbHour > 0 ? (
              // RAM Reservoir on: a single admin-set network rate applies to every operator (your own
              // price below is superseded). This is what each agent you host bills you at.
              <>
                <dt>Network RAM rate</dt>
                <dd>
                  {ratePerHourPrecise(reservoir.price.perAgentEpoch, reservoir.price.epochMs)} per
                  agent · {formatGbHourPrice(reservoir.price.perGbHour)}/GB-hour
                </dd>
              </>
            ) : (
              <>
                <dt>Rent price</dt>
                <dd>{price === null ? '—' : price > 0 ? ratePerHour(price, epochMs) : 'free'}</dd>
              </>
            )}
            {!community && (
              <>
                <dt>Rent earned</dt>
                <dd>{formatAmount(earnedTotal)}</dd>
                <dt>Network capacity</dt>
                <dd>
                  {net
                    ? `${net.operators} other operator${net.operators === 1 ? '' : 's'} · ${net.freeSlots} slots free`
                    : '—'}
                </dd>
              </>
            )}
          </dl>

          {/* Community ("Free Agents"): RAM is donated free, so there's no rent price to set and no
              public endpoint to advertise to renters — hide the whole pricing + endpoint block. */}
          {community ? null : (
            <>
              {/* Per-operator rent pricing is superseded by the RAM Reservoir: when the admin has set one
              global network price, every agent bills that rate (see "Network RAM rate" above) and an
              operator's own price has no effect — so hide the control and explain it. Only when the
              reservoir is off (legacy per-operator marketplace) does the operator set their own price. */}
              {reservoir && reservoir.price.perGbHour > 0 ? (
                <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  The network sets one global RAM price (admin-managed) — you're paid that rate for
                  every agent you host, keeping the operator share (the platform takes its
                  commission). Your own rent price isn't used while the reservoir is active.
                  <br />
                  {offerHost
                    ? `✓ Rent is paid to ${offerHost}.`
                    : 'Registering your payout account…'}
                </p>
              ) : (
                /* Legacy per-operator pricing: set the per-epoch rent to run one agent body. 0 = free. */
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginTop: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <input
                    type="number"
                    min={0}
                    step={1}
                    placeholder={price === null ? 'USDC minor / epoch' : String(price)}
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    style={{ maxWidth: 200 }}
                  />
                  <button type="button" className="btn act" disabled={saving} onClick={savePrice}>
                    {saving ? 'Saving…' : 'Set rent price'}
                  </button>
                  <span className="muted" style={{ fontSize: 12 }}>
                    per agent · 100 minor = 1.00 USDC/epoch
                    {price !== null && price > 0 && epochMs > 0
                      ? ` (renters see ≈ ${ratePerHour(price, epochMs)})`
                      : ''}{' '}
                    · billed each epoch, shown to renters per hour · you keep the operator share,
                    the platform takes its commission
                  </span>
                </div>
              )}

              {/* Optional public endpoint advertised to renters (shown in their "Your rentals" IP column).
              Leave blank if this node is NAT'd / relay-only — renters then see "relay-only". */}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  marginTop: 10,
                  flexWrap: 'wrap',
                }}
              >
                <input
                  type="text"
                  placeholder={endpoint || 'https://your-node.example.com  (blank = relay-only)'}
                  value={endpointInput}
                  onChange={(e) => setEndpointInput(e.target.value)}
                  style={{ maxWidth: 320 }}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={savingEndpoint}
                  onClick={saveEndpoint}
                >
                  {savingEndpoint ? 'Saving…' : 'Set public endpoint'}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  {endpoint
                    ? `renters see ${endpoint}`
                    : 'optional · renters see "relay-only" until set · clear the field to reset'}
                </span>
              </div>
            </>
          )}
          {msg && (
            <p className={msg.kind === 'ok' ? 'ok' : 'err'} style={{ margin: '8px 0 0' }}>
              {msg.text}
            </p>
          )}
        </div>

        <div className="card">
          <div className="section-title">Agents you're hosting</div>
          {hostRows.length === 0 ? (
            <div className="empty">
              {community ? (
                <>
                  No agents are running on your node yet. When the network places someone's agent on
                  your donated slots it shows here — just keep the app open and online.
                </>
              ) : (
                <>
                  You're not hosting any agents yet. When an owner's agent is placed on your node it
                  shows here — make sure you've contributed RAM in <b>Run a node</b> and your node
                  is online.
                </>
              )}
            </div>
          ) : (
            <div className="hscroll">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Owner</th>
                    <th>Model</th>
                    <th>Status</th>
                    {!community && <th>Rent earned</th>}
                  </tr>
                </thead>
                <tbody>
                  {hostRows.map((a) => (
                    <tr key={a.agentId}>
                      <td>
                        <strong>{a.name}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {a.agentId}
                        </div>
                      </td>
                      <td>{shortKey(a.owner)}</td>
                      <td>{a.model || '—'}</td>
                      <td>
                        {a.hasLocal ? (
                          <span className={a.running ? 'pill ok' : 'pill'}>
                            {a.running ? 'running' : 'stopped'}
                          </span>
                        ) : (
                          // The dashboard is connected to a node OTHER than the physical host (e.g. a
                          // seed node), so the live body isn't visible here — but the ledger proves it.
                          <span
                            className="chip"
                            title="hosted on your node; connect to it for live status"
                          >
                            hosted
                          </span>
                        )}
                      </td>
                      {!community && <td>{formatAmount(a.earned)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
