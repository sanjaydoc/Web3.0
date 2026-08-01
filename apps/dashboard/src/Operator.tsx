import { useCallback, useEffect, useState } from 'react';
import {
  type Account as Acct,
  type AuthorityRequest,
  type Economics,
  type MyEarnings,
  type NodeLocation,
  type NodeOperator,
  type NodeRole,
  type StorageInfo,
  api,
  formatAmount,
} from './api.js';

/** The Electron preload bridge (desktop app only) — lets the console start/stop the local node. */
interface DesktopBridge {
  isDesktop: boolean;
  startNode: () => Promise<{ running: boolean }>;
  stopNode: () => Promise<{ running: boolean }>;
  nodeStatus: () => Promise<{ running: boolean }>;
  /** Re-pull the local model for the current contributed-RAM tier (Host-LLM tunnel). */
  ensureModel?: () => Promise<{ pulled: boolean; model?: string; reason?: string }>;
}
const desktop: DesktopBridge | undefined =
  typeof window !== 'undefined'
    ? (window as unknown as { web3desktop?: DesktopBridge }).web3desktop
    : undefined;

/**
 * Node status + control. The green light shows whether the node is reachable (online) — everywhere,
 * web and desktop. In the desktop app a Start/Stop button appears (via the preload bridge); on the
 * web console the node is remote, so it's status-only.
 */
function NodeControl({ online }: { online: boolean }) {
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  // While starting, the process is up but not yet reachable — clear the pending state once it is.
  useEffect(() => {
    if (online && starting) setStarting(false);
  }, [online, starting]);

  const toggle = async () => {
    if (!desktop) return;
    setBusy(true);
    try {
      if (online) {
        await desktop.stopNode();
      } else {
        setStarting(true);
        await desktop.startNode();
      }
    } catch {
      setStarting(false);
    } finally {
      setBusy(false);
    }
  };

  const label = online ? 'Node running' : starting ? 'Starting…' : 'Node stopped';
  const dotColor = online ? 'var(--ok)' : starting ? 'var(--gold, #f2c14e)' : 'var(--no)';

  return (
    <div
      className="card"
      style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14 }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: dotColor,
          boxShadow: online ? '0 0 0 4px color-mix(in srgb, var(--ok) 22%, transparent)' : 'none',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="muted" style={{ fontSize: 'var(--fs-small, 13px)' }}>
          {desktop
            ? online
              ? 'Your node is live on the shared network and contributing.'
              : 'Your node is off — start it to join the network and earn.'
            : online
              ? 'Connected to the node.'
              : 'The node is not reachable.'}
        </div>
      </div>
      {desktop && (
        <button
          type="button"
          className={`btn ${online ? 'danger' : 'act'}`}
          disabled={busy}
          onClick={toggle}
        >
          {busy ? '…' : online ? 'Stop node' : 'Start node'}
        </button>
      )}
    </div>
  );
}

/** Live monetary policy — visible to any signed-in operator, editable by the admin. */
function EconomicsCard() {
  const [eco, setEco] = useState<Economics | null>(null);
  const [feeBps, setFeeBps] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    api
      .economics()
      .then((e) => {
        setEco(e);
        setFeeBps(String(e.feeBps));
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const next = await api.updateEconomics({
        feeBps: Math.round(Number.parseFloat(feeBps || '0')),
      });
      setEco(next);
      setMsg({
        kind: 'ok',
        text: 'Saved — the new fee applies immediately, network-wide on this node.',
      });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!eco) return null;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="section-title">Economics</div>
      <p className="muted" style={{ margin: '2px 0 12px' }}>
        The node's live monetary policy. USDC-only: the platform fee is the sole knob — there is no
        token issuance (block rewards, minted rewards, burns and staking were retired). Node revenue
        comes from real demand: this fee plus hosting/inference commission, all in USDC. Authority
        admission is invite-only. Admin-only to change; applies without a restart.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="eco-fee">Protocol fee (bps)</label>
          <input id="eco-fee" value={feeBps} onChange={(ev) => setFeeBps(ev.target.value)} />
          <span className="hint">100 bps = 1% of every payment, split treasury / serving node</span>
        </div>
      </div>

      <div className="gen-actions">
        <button type="button" className="btn act" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save policy'}
        </button>
      </div>
      {msg && (
        <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
      )}
    </div>
  );
}

/**
 * Revenue — the platform's take-rates on the two demand-funded, internal-ledger flows. Admin-editable
 * and live (persisted; applies to the next charge, no restart). Shown as percentages; stored as bps.
 * (x402 skill calls settle peer-to-peer straight to the agent — non-custodial, 0% — so they're not
 * here.)
 */
function RevenueCard() {
  const [eco, setEco] = useState<Economics | null>(null);
  const [hosting, setHosting] = useState('');
  const [inference, setInference] = useState('');
  // Max inference price a node operator may advertise, shown/edited in USDC per Mtok (stored as
  // minor units). Empty/0 = no cap.
  const [priceCap, setPriceCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    api
      .economics()
      .then((e) => {
        setEco(e);
        setHosting(String(e.hostingCommissionBps / 100));
        setInference(String(e.inferenceCommissionBps / 100));
        setPriceCap(String(e.maxInferencePriceMTok / 100));
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const next = await api.updateEconomics({
        hostingCommissionBps: Math.round(Number.parseFloat(hosting || '0') * 100),
        inferenceCommissionBps: Math.round(Number.parseFloat(inference || '0') * 100),
        maxInferencePriceMTok: Math.round(Number.parseFloat(priceCap || '0') * 100),
      });
      setEco(next);
      setMsg({
        kind: 'ok',
        text: 'Saved — applies to the next charge, network-wide on this node.',
      });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!eco) return null;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="section-title">Revenue</div>
      <p className="muted" style={{ margin: '2px 0 12px' }}>
        Your platform commission on demand-funded fees, in USDC. The rest goes to the node operator
        who contributed the RAM. Change it anytime — it applies to the next charge, no restart.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="rev-hosting">RAM hosting commission (%)</label>
          <input
            id="rev-hosting"
            value={hosting}
            onChange={(ev) => setHosting(ev.target.value)}
            inputMode="decimal"
          />
          <span className="hint">
            platform keeps {hosting || '0'}% · operator keeps{' '}
            {100 - (Number.parseFloat(hosting) || 0)}%
          </span>
        </div>
        <div className="field">
          <label htmlFor="rev-inference">LLM inference commission (%)</label>
          <input
            id="rev-inference"
            value={inference}
            onChange={(ev) => setInference(ev.target.value)}
            inputMode="decimal"
          />
          <span className="hint">
            platform keeps {inference || '0'}% · operator keeps{' '}
            {100 - (Number.parseFloat(inference) || 0)}%
          </span>
        </div>
        <div className="field">
          <label htmlFor="rev-pricecap">Max inference price (USDC / Mtok)</label>
          <input
            id="rev-pricecap"
            value={priceCap}
            onChange={(ev) => setPriceCap(ev.target.value)}
            inputMode="decimal"
          />
          <span className="hint">
            price ceiling for node operators — an offer above this is rejected.{' '}
            {Number.parseFloat(priceCap) > 0 ? `cap ${priceCap} USDC/Mtok` : '0 = no cap'}
          </span>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        x402 skill-call payments settle peer-to-peer straight to the agent (non-custodial) — the
        platform takes 0% on those.
      </p>
      <div className="gen-actions">
        <button type="button" className="btn act" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save revenue settings'}
        </button>
      </div>
      {msg && (
        <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
      )}
    </div>
  );
}

/** Persistence settings (admin) — saves to the node's config file; restart to apply. */
function StorageCard() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [uri, setUri] = useState('');
  const [db, setDb] = useState('web3');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    api
      .storageInfo()
      .then((i) => {
        setInfo(i);
        setDb(i.mongodbDb);
      })
      .catch(() => undefined); // non-admins simply don't see the card
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.saveStorage({ mongodbUri: uri, mongodbDb: db });
      setMsg({
        kind: 'ok',
        text: `Saved to ${res.configPath} — restart the node (or the desktop app) to apply.`,
      });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!info) return null;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="section-title">Storage</div>
      <p className="muted" style={{ margin: '2px 0 12px' }}>
        <b>{info.kind === 'mongodb' ? 'MongoDB' : 'In-memory'}</b> — {info.note}
        {info.mongodbUriHint && (
          <>
            {' '}
            · <code>{info.mongodbUriHint}</code>
          </>
        )}
      </p>
      <div className="form-grid">
        <div className="field wide">
          <label htmlFor="st-uri">MongoDB connection string</label>
          <input
            id="st-uri"
            type="password"
            value={uri}
            onChange={(ev) => setUri(ev.target.value)}
            placeholder="mongodb+srv://user:password@cluster…"
          />
          <span className="hint">stored only in this node's local config file — never shared</span>
        </div>
        <div className="field">
          <label htmlFor="st-db">Database name</label>
          <input id="st-db" value={db} onChange={(ev) => setDb(ev.target.value)} />
        </div>
      </div>
      <div className="gen-actions">
        <button type="button" className="btn act" disabled={busy || !uri.trim()} onClick={save}>
          {busy ? 'Saving…' : 'Save storage settings'}
        </button>
      </div>
      {msg && (
        <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
      )}
    </div>
  );
}

const ROLE_HELP: Record<NodeRole, string> = {
  solo: 'running its own chain — not joined to a shared network yet',
  relay: 'carries traffic, hosts agents, verifies the shared chain',
  authority: 'signs blocks and keeps consensus for the network',
};

/** Authority is invite-only: request it, the admin approves, and the seating happens on-chain. */
function AuthorityCard({ role }: { role: NodeRole }) {
  const [mine, setMine] = useState<AuthorityRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const refresh = () => {
    api
      .myAuthorityRequest()
      .then((r) => setMine(r.request))
      .catch(() => undefined);
  };
  useEffect(refresh, []);

  async function request() {
    setBusy(true);
    setErr('');
    try {
      setMine(await api.requestAuthority());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (role === 'authority') {
    return (
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Authority status</div>
        <p className="muted" style={{ margin: '2px 0 0' }}>
          This node is in the authority set — it proposes and signs blocks for the network.
        </p>
      </div>
    );
  }
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="section-title">Become an authority</div>
      <p className="muted" style={{ margin: '2px 0 14px' }}>
        Authority nodes sign the chain's blocks. Admission is <b>invite-only</b> — request it below
        and the admin approves; the seating then happens on-chain automatically. No staking, no
        minting — you don't run a node to earn a seat, you host agents and earn hosting fees.
      </p>
      {mine && (
        <p style={{ margin: '0 0 12px' }}>
          Your request:{' '}
          <span
            className={`chip ${mine.status === 'approved' ? 'allow' : mine.status === 'rejected' ? 'deny' : ''}`}
          >
            {mine.status}
          </span>{' '}
          <span className="muted">
            {mine.status === 'pending' && '— waiting for the admin'}
            {mine.status === 'approved' && `— approved ${mine.decidedAt?.slice(0, 10) ?? ''}`}
            {mine.status === 'rejected' && '— you may request again'}
          </span>
        </p>
      )}
      {(!mine || mine.status === 'rejected') && (
        <button type="button" className="btn act" disabled={busy} onClick={request}>
          {busy ? 'Sending…' : 'Request authority status'}
        </button>
      )}
      {err && <div className="note note-err">{err}</div>}
    </div>
  );
}

/** Set / update the operator's position on the Network map — browser GPS or typed manually. */
function NodeLocationCard() {
  const [mine, setMine] = useState<NodeLocation | null>(null);
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [me, locs] = await Promise.all([api.me(), api.nodeLocations()]);
        const loc = locs.locations.find((l) => l.address === me.address) ?? null;
        setMine(loc);
        if (loc) {
          setLabel(loc.label);
          setLat(String(loc.lat));
          setLon(String(loc.lon));
        }
      } catch {
        /* signed out or node offline */
      }
    })();
  }, []);

  // Electron's Chromium routes navigator.geolocation through Google's geolocation service, which needs
  // an API key the desktop app doesn't ship — so GPS fails there with a "network service" error.
  // Fall back to approximate, key-less IP geolocation (city-level) so the button still works; the user
  // can always fine-tune the coordinates by hand before saving.
  const ipLocate = async (): Promise<boolean> => {
    try {
      const res = await fetch('https://ipwho.is/');
      const d = (await res.json()) as {
        success?: boolean;
        latitude?: number;
        longitude?: number;
        city?: string;
      };
      if (d.success && typeof d.latitude === 'number' && typeof d.longitude === 'number') {
        setLat(d.latitude.toFixed(4));
        setLon(d.longitude.toFixed(4));
        if (d.city && !label) setLabel(d.city);
        setMsg({
          kind: 'ok',
          text: `Approx. location from your network${d.city ? ` (${d.city})` : ''} — adjust if needed, then Save.`,
        });
        return true;
      }
    } catch {
      /* network/service unavailable */
    }
    return false;
  };

  const useGps = () => {
    setMsg(null);
    setBusy(true);
    const fallback = async () => {
      const ok = await ipLocate();
      setBusy(false);
      if (!ok) {
        setMsg({
          kind: 'err',
          text: "Couldn't detect your location automatically — enter the coordinates manually.",
        });
      }
    };
    if (!navigator.geolocation) {
      void fallback();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(4));
        setLon(pos.coords.longitude.toFixed(4));
        setBusy(false);
        setMsg({ kind: 'ok', text: 'Location captured — press Save to publish it to the map.' });
      },
      // GPS/permission failed — common in the desktop app (no geolocation key) — try IP-based instead.
      () => void fallback(),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  async function saveLoc() {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api.setNodeLocation({
        lat: Number.parseFloat(lat),
        lon: Number.parseFloat(lon),
        label: label.trim(),
      });
      setMine(saved);
      setMsg({
        kind: 'ok',
        text: `Saved — your node now shows at "${saved.label || 'unnamed'}" on the Network map.`,
      });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function removeLoc() {
    setBusy(true);
    setMsg(null);
    try {
      await api.clearNodeLocation();
      setMine(null);
      setLabel('');
      setLat('');
      setLon('');
      setMsg({ kind: 'ok', text: 'Removed — your node is off the map.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="section-title">Node location</div>
      <p className="muted" style={{ margin: '2px 0 12px' }}>
        Where your node appears on the Network map. Opt-in: only what you save here is shared, and
        you can remove it any time.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="loc-label">Place name</label>
          <input
            id="loc-label"
            value={label}
            onChange={(ev) => setLabel(ev.target.value)}
            placeholder="e.g. Chennai"
          />
        </div>
        <div className="field">
          <label htmlFor="loc-lat">Latitude · longitude</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="loc-lat"
              value={lat}
              onChange={(ev) => setLat(ev.target.value)}
              placeholder="13.0827"
            />
            <input
              aria-label="Longitude"
              value={lon}
              onChange={(ev) => setLon(ev.target.value)}
              placeholder="80.2707"
            />
          </div>
          <span className="hint">decimal degrees — south / west are negative</span>
        </div>
      </div>
      <div className="gen-actions">
        <button type="button" className="btn act" disabled={busy} onClick={useGps}>
          Use my location
        </button>
        <button
          type="button"
          className="btn act"
          disabled={busy || !lat.trim() || !lon.trim()}
          onClick={saveLoc}
        >
          {busy ? 'Working…' : mine ? 'Update on map' : 'Save to map'}
        </button>
        {mine && (
          <button type="button" className="btn act" disabled={busy} onClick={removeLoc}>
            Remove from map
          </button>
        )}
      </div>
      {msg && (
        <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
      )}
    </div>
  );
}

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
}

export function Operator() {
  const [node, setNode] = useState<NodeOperator | null>(null);
  // The signed-in account's role decides what this page shows: an admin sees the node OWNER's
  // console (treasury, collect, contribution caps); everyone else sees only their OWN earnings.
  const [me, setMe] = useState<Acct | null>(null);
  const [mine, setMine] = useState<MyEarnings | null>(null);
  const isAdmin = me?.role === 'admin';
  // Who sees the node-OWNER console (load, authority, location, treasury)? Anyone running THIS node:
  // an admin on any node, OR any operator on a node that isn't the reserved admin-only MAIN node —
  // i.e. their own desktop/self-hosted node. On the main node a plain operator still sees only their
  // personal earnings (that node isn't theirs). Network-policy cards (Economics, Storage) stay
  // admin-only. Contribution + "Hosting · sell your RAM" now live on the dedicated Hosting page.
  const ownsNode = isAdmin || !node?.auth?.adminOnly;
  const [busy, setBusy] = useState(false);
  // Whether the node is reachable right now — drives the green on/off light.
  const [online, setOnline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const n = await api.node();
      setNode(n);
      setOnline(true);
    } catch {
      setOnline(false); // node offline / unreachable
    }
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null));
    api
      .myEarnings()
      .then(setMine)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const [collectMsg, setCollectMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function collect() {
    setBusy(true);
    setCollectMsg(null);
    try {
      const res = await api.collectEarnings();
      setCollectMsg({
        kind: 'ok',
        text: `Collected ${res.collectedFormatted} — your wallet holds ${formatAmount(res.walletBalance)}.`,
      });
      refresh();
    } catch (err) {
      setCollectMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const e = node?.earnings;
  const r = node?.resources;
  const budgetMb =
    node && node.limits.maxRamMb > 0 ? node.limits.maxRamMb : (r?.systemTotalMb ?? 0);
  const ramPct = r && budgetMb ? Math.min(100, Math.round((r.processRssMb / budgetMb) * 100)) : 0;

  return (
    <>
      <div className="page-head">
        <h1>
          {ownsNode ? 'My node' : 'Earnings'}{' '}
          {ownsNode && node && (
            <span className={`role-badge ${node.role}`}>{node.role.toUpperCase()}</span>
          )}
        </h1>
        <span className="muted">
          {ownsNode
            ? node
              ? ROLE_HELP[node.role]
              : 'what this node earns, carries, and contributes to Web3.0'
            : 'your wallet and income on the Web3.0 network'}
        </span>
      </div>

      <NodeControl online={online} />

      {!node && (
        <div className="card empty">Node offline — start it to see live earnings and load.</div>
      )}

      {node && (
        <>
          <div className="grid-2" style={{ marginBottom: 18 }}>
            {isAdmin ? (
              // The node TREASURY (accumulated fees) + the sweep-to-wallet action — the node owner's
              // money. Only the admin sees the treasury; an operator sees their OWN wallet below
              // (their personal earnings), even on their own node.
              <div className="card">
                <div className="section-title">Node earnings</div>
                <div
                  style={{
                    fontFamily: 'var(--serif)',
                    fontSize: 'var(--fs-xl)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {e?.formatted}
                </div>
                <p className="muted" style={{ margin: '2px 0 12px' }}>
                  in <code>{node.treasuryId}</code>
                </p>
                <dl className="kv">
                  <dt>Treasury fees</dt>
                  <dd>{formatAmount(e?.fees ?? 0)}</dd>
                  <dt>Node fee-share</dt>
                  <dd>{formatAmount(e?.contribution ?? 0)}</dd>
                </dl>
                {e && e.balance === 0 && (e.contribution ?? 0) === 0 && (
                  <p className="hint">
                    Node revenue comes from real demand — the platform fee (
                    <code>WEB3_FEE_BPS</code>) plus hosting/inference commission, all in USDC.
                    Nothing is earned until agents transact or rent your capacity.
                  </p>
                )}
                {e && (e.balance > 0 || (e.contribution ?? 0) > 0) && (
                  <button type="button" className="btn act" disabled={busy} onClick={collect}>
                    {busy ? 'Collecting…' : 'Collect to wallet'}
                  </button>
                )}
                {collectMsg && (
                  <div className={`note ${collectMsg.kind === 'err' ? 'note-err' : 'note-ok'}`}>
                    {collectMsg.text}
                  </div>
                )}
              </div>
            ) : (
              // Everyone else: YOUR earnings — your wallet balance and income on the network. Never
              // the node treasury or a Collect button (that money isn't yours).
              <div className="card">
                <div className="section-title">Your earnings</div>
                <div
                  style={{
                    fontFamily: 'var(--serif)',
                    fontSize: 'var(--fs-xl)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {formatAmount(mine?.balance ?? 0)}
                </div>
                <p className="muted" style={{ margin: '2px 0 12px' }}>
                  in your wallet <code>{mine?.address ?? me?.address ?? ''}</code>
                </p>
                <dl className="kv">
                  <dt>Received</dt>
                  <dd>{formatAmount(mine?.received ?? 0)}</dd>
                  <dt>Sent</dt>
                  <dd>{formatAmount(mine?.sent ?? 0)}</dd>
                  <dt>Transactions</dt>
                  <dd>{mine?.txCount ?? 0}</dd>
                </dl>
                <p className="hint">
                  Send and receive USDC from the <b>Account</b> page. The node treasury belongs to
                  the node owner.
                </p>
              </div>
            )}

            {ownsNode && (
              <div className="card">
                <div className="section-title">Load &amp; uptime</div>
                <dl className="kv">
                  <dt>Uptime</dt>
                  <dd>{uptime(node.uptimeSec)}</dd>
                  <dt>Memory (node)</dt>
                  <dd>
                    {r?.processRssMb} MB{' '}
                    <span className="muted">
                      /{' '}
                      {node.limits.maxRamMb > 0
                        ? `${node.limits.maxRamMb} MB budget`
                        : `${r?.systemTotalMb} MB system`}
                    </span>
                  </dd>
                  <dt>CPU</dt>
                  <dd>
                    {r?.cpus} cores · load {r?.loadAvg1}
                  </dd>
                </dl>
                <div
                  style={{
                    height: 8,
                    borderRadius: 6,
                    background: 'var(--hair)',
                    overflow: 'hidden',
                    marginTop: 6,
                  }}
                >
                  <div
                    style={{
                      width: `${ramPct}%`,
                      height: '100%',
                      background: ramPct > 85 ? 'var(--no)' : 'var(--ok)',
                    }}
                  />
                </div>
                <p className="hint">{ramPct}% of contributed RAM in use</p>
              </div>
            )}
          </div>

          {/* Contribution + "Hosting · sell your RAM" now live on the dedicated Hosting page.
              Node-owner cards below (Economics + Storage) stay admin-only. */}

          {ownsNode && <AuthorityCard role={node.role} />}

          {isAdmin && <RevenueCard />}

          {isAdmin && <EconomicsCard />}

          {isAdmin && <StorageCard />}

          {ownsNode && <NodeLocationCard />}

          {ownsNode && (
            <div className="card">
              <div className="section-title">This node</div>
              <dl className="kv">
                <dt>Traffic</dt>
                <dd>
                  {node.traffic.agents} agents · {node.traffic.online} online ·{' '}
                  {node.traffic.ledgerEntries} ledger entries
                </dd>
                <dt>Consensus</dt>
                <dd>
                  {node.consensus.mode === 'poa'
                    ? `PoA · ${node.consensus.authorities} authorities · height ${node.consensus.height} · ${node.consensus.peers} peers`
                    : 'solo node'}
                </dd>
                <dt>Settlement</dt>
                <dd>
                  {node.settlement.mode} · {node.settlement.network}
                </dd>
                <dt>Node key</dt>
                <dd className="mono-hash">
                  {node.nodePublicKey ? `${node.nodePublicKey.slice(0, 28)}…` : '—'}
                </dd>
              </dl>
            </div>
          )}
        </>
      )}
    </>
  );
}
