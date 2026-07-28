import { useCallback, useEffect, useState } from 'react';
import {
  type Account as Acct,
  type AuthorityRequest,
  type Economics,
  type Lease,
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
  const dotColor = online ? 'var(--ok)' : starting ? 'var(--gold, #f2c14e)' : 'var(--no, #c0392b)';

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
          className="btn act"
          disabled={busy}
          onClick={toggle}
          style={
            online ? { background: 'var(--no, #c0392b)', borderColor: 'transparent' } : undefined
          }
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
  const [burnBps, setBurnBps] = useState('');
  const [rewardAeth, setRewardAeth] = useState('');
  const [poolAeth, setPoolAeth] = useState('');
  const [epochBlocks, setEpochBlocks] = useState('');
  const [capBps, setCapBps] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    api
      .economics()
      .then((e) => {
        setEco(e);
        setFeeBps(String(e.feeBps));
        setBurnBps(String(e.burnBps));
        setRewardAeth((e.blockReward / 100).toString());
        setPoolAeth((e.nodeRewardPool / 100).toString());
        setEpochBlocks(String(e.epochBlocks));
        setCapBps(String(e.rewardCapBps));
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const next = await api.updateEconomics({
        feeBps: Math.round(Number.parseFloat(feeBps || '0')),
        burnBps: Math.round(Number.parseFloat(burnBps || '0')),
        blockReward: Math.round(Number.parseFloat(rewardAeth || '0') * 100),
        nodeRewardPool: Math.round(Number.parseFloat(poolAeth || '0') * 100),
        epochBlocks: Math.round(Number.parseFloat(epochBlocks || '0')),
        rewardCapBps: Math.round(Number.parseFloat(capBps || '0')),
      });
      setEco(next);
      setMsg({
        kind: 'ok',
        text: 'Saved — the new policy applies immediately, network-wide on this node.',
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
        The node's live monetary policy — fees fund operators and burns give aETH scarcity.
        Authority admission is invite-only (no stake). Admin-only to change; applies without a
        restart.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="eco-fee">Protocol fee (bps)</label>
          <input id="eco-fee" value={feeBps} onChange={(ev) => setFeeBps(ev.target.value)} />
          <span className="hint">100 bps = 1% of every payment → node treasury</span>
        </div>
        <div className="field">
          <label htmlFor="eco-burn">Burn (bps)</label>
          <input id="eco-burn" value={burnBps} onChange={(ev) => setBurnBps(ev.target.value)} />
          <span className="hint">EIP-1559-style: burned forever → supply sink</span>
        </div>
        <div className="field">
          <label htmlFor="eco-reward">Block reward (aETH)</label>
          <input
            id="eco-reward"
            value={rewardAeth}
            onChange={(ev) => setRewardAeth(ev.target.value)}
          />
          <span className="hint">minted to the proposer's treasury per block</span>
        </div>
      </div>

      <div className="section-title" style={{ fontSize: 'var(--fs-title)', marginTop: 14 }}>
        Node contribution rewards
      </div>
      <p className="muted" style={{ margin: '2px 0 10px' }}>
        Proof-of-Contribution: pay every live node — not just authorities — for the uptime and
        compute it lends. The pool is minted each epoch and split across contributors by score,
        capped per node. Set the pool to 0 to turn the engine off.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="eco-pool">Reward pool / epoch (aETH)</label>
          <input id="eco-pool" value={poolAeth} onChange={(ev) => setPoolAeth(ev.target.value)} />
          <span className="hint">split across live contributing nodes · 0 = off</span>
        </div>
        <div className="field">
          <label htmlFor="eco-epoch">Epoch length (blocks)</label>
          <input
            id="eco-epoch"
            value={epochBlocks}
            onChange={(ev) => setEpochBlocks(ev.target.value)}
          />
          <span className="hint">pool is distributed once every this many blocks</span>
        </div>
        <div className="field">
          <label htmlFor="eco-cap">Per-node cap (bps)</label>
          <input id="eco-cap" value={capBps} onChange={(ev) => setCapBps(ev.target.value)} />
          <span className="hint">2000 = one node may take at most 20% · 0 = uncapped</span>
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

const ADMIN_KEY = 'web3.adminToken';

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
          📍 Use my location
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

/**
 * HostingCard — the host side of the compute marketplace. Set the per-epoch price you charge to run
 * one agent, see your net hosting revenue, and view who's renting your capacity. Selling your
 * contributed RAM earns aETH here (minus the platform commission).
 */
function HostingCard() {
  const [price, setPrice] = useState('');
  const [offerPrice, setOfferPrice] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [me, setMe] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [offer, rev, ls, acct] = await Promise.all([
        api.hostingOffer(),
        api.hostingRevenue(),
        api.hostingLeases(),
        api.me(),
      ]);
      setOfferPrice(offer.pricePerEpoch);
      setRevenue(rev.revenue);
      setMe(acct.address);
      setLeases(ls.leases);
    } catch {
      /* offline — keep last */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const save = async () => {
    const v = Math.round(Number(price));
    if (!Number.isFinite(v) || v < 0) {
      setMsg({ kind: 'err', text: 'Enter a price in aETH minor units (0 to stop offering).' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.setHostingOffer(v);
      setPrice('');
      setMsg({ kind: 'ok', text: 'Hosting price updated.' });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const hosted = leases.filter((l) => l.active && l.host === me);

  return (
    <div className="card">
      <div className="section-title">Hosting · sell your RAM</div>
      <p className="muted" style={{ margin: '2px 0 12px' }}>
        Set what you charge to run one agent per epoch. Renters pay from their wallet each epoch;
        you keep the fee minus the platform commission.
      </p>
      <dl className="kv">
        <dt>Current price / epoch</dt>
        <dd>{offerPrice > 0 ? formatAmount(offerPrice) : 'not offering'}</dd>
        <dt>Net hosting revenue</dt>
        <dd>{formatAmount(revenue)}</dd>
        <dt>Agents hosted</dt>
        <dd>{hosted.length}</dd>
      </dl>
      <div className="field" style={{ maxWidth: 300, marginTop: 10 }}>
        <label htmlFor="host-price">New price / epoch (aETH minor units)</label>
        <input
          id="host-price"
          type="number"
          min={0}
          value={price}
          placeholder={String(offerPrice)}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
      {msg && (
        <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
      )}
      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn act" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Update price'}
        </button>
      </div>
      {hosted.length > 0 && (
        <div className="hscroll" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Renter</th>
                <th>Price / epoch</th>
                <th>Epochs</th>
              </tr>
            </thead>
            <tbody>
              {hosted.map((l) => (
                <tr key={l.id}>
                  <td>{l.agentId}</td>
                  <td>{l.owner}</td>
                  <td>{formatAmount(l.pricePerEpoch)}</td>
                  <td>{l.epochsBilled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Operator() {
  const [node, setNode] = useState<NodeOperator | null>(null);
  // The signed-in account's role decides what this page shows: an admin sees the node OWNER's
  // console (treasury, collect, contribution caps); everyone else sees only their OWN earnings.
  const [me, setMe] = useState<Acct | null>(null);
  const [mine, setMine] = useState<MyEarnings | null>(null);
  const isAdmin = me?.role === 'admin';
  const [admin, setAdmin] = useState(() => localStorage.getItem(ADMIN_KEY) ?? '');
  // Who sees the node-OWNER console (load, contribution, authority, location, treasury)? Anyone
  // running THIS node: an admin on any node, OR any operator on a node that isn't the reserved
  // admin-only MAIN node — i.e. their own desktop/self-hosted node. On the main node a plain
  // operator still sees only their personal earnings (that node isn't theirs). Network-policy cards
  // (Economics, Storage) stay admin-only.
  const ownsNode = isAdmin || !node?.auth?.adminOnly;
  const [adminReq, setAdminReq] = useState(false);
  const [contribute, setContribute] = useState(true);
  const [maxRamGb, setMaxRamGb] = useState('0');
  const [maxAgents, setMaxAgents] = useState('0');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [touched, setTouched] = useState(false);
  // Whether the node is reachable right now — drives the green on/off light.
  const [online, setOnline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const n = await api.node();
      setNode(n);
      setOnline(true);
      if (!touched) {
        setContribute(n.limits.contribute);
        setMaxRamGb((n.limits.maxRamMb / 1024).toFixed(1).replace(/\.0$/, ''));
        setMaxAgents(String(n.limits.maxAgents));
      }
    } catch {
      setOnline(false); // node offline / unreachable
    }
    api
      .telegram()
      .then((t) => setAdminReq(t.adminRequired))
      .catch(() => undefined);
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null));
    api
      .myEarnings()
      .then(setMine)
      .catch(() => undefined);
  }, [touched]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const rememberAdmin = (v: string) => {
    setAdmin(v);
    localStorage.setItem(ADMIN_KEY, v);
  };

  async function save() {
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
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const [collectMsg, setCollectMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function collect() {
    setBusy(true);
    setCollectMsg(null);
    try {
      const res = await api.collectEarnings();
      setCollectMsg({
        kind: 'ok',
        text: `Collected ${res.collectedFormatted} — your wallet holds ${formatAmount(res.walletBalance)}. Stake it below.`,
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
              // The node TREASURY (fees + block rewards) + the sweep-to-wallet action — the node
              // owner's money. Only the admin sees the treasury; an operator sees their OWN wallet
              // below (their personal earnings), even on their own node.
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
                  <dt>Protocol fees</dt>
                  <dd>{formatAmount(e?.fees ?? 0)}</dd>
                  <dt>Block rewards</dt>
                  <dd>{formatAmount(e?.rewards ?? 0)}</dd>
                  <dt>Contribution rewards</dt>
                  <dd>{formatAmount(e?.contribution ?? 0)}</dd>
                </dl>
                {e && e.balance === 0 && (e.contribution ?? 0) === 0 && (
                  <p className="hint">
                    Earnings are off by default — set <code>WEB3_FEE_BPS</code>,{' '}
                    <code>WEB3_BLOCK_REWARD</code>, or a <b>node reward pool</b> (below) to start
                    earning.
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
                  Send and receive aETH from the <b>Account</b> page. The node treasury belongs to
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

          {ownsNode && node.contribution && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="section-title">Contribution rewards</div>
              <p className="muted" style={{ margin: '2px 0 12px' }}>
                {node.contribution.enabled
                  ? 'Proof-of-Contribution is live — your node earns aETH each epoch for the uptime and compute it lends, alongside every other live node.'
                  : 'Proof-of-Contribution is off. Set a node reward pool in Economics to start paying live nodes for the resources they contribute.'}
              </p>
              <dl className="kv">
                <dt>Your score</dt>
                <dd>
                  {node.contribution.myScore}{' '}
                  <span className="muted">
                    of {node.contribution.totalScore} across {node.contribution.liveContributors}{' '}
                    live node{node.contribution.liveContributors === 1 ? '' : 's'}
                  </span>
                </dd>
                <dt>Projected / epoch</dt>
                <dd>
                  {formatAmount(node.contribution.projectedPerEpoch)}{' '}
                  <span className="muted">
                    from a {formatAmount(node.contribution.pool)} pool every{' '}
                    {node.contribution.epochBlocks} blocks
                  </span>
                </dd>
                <dt>Earned, uncollected</dt>
                <dd>{node.contribution.walletFormatted}</dd>
              </dl>
              <p className="hint">
                {isAdmin ? (
                  <>
                    Contribution rewards land in your node's reward wallet and sweep into your
                    account with <b>Collect to wallet</b> above.
                  </>
                ) : (
                  <>
                    Contribution rewards accrue to your node's reward wallet and are collected by
                    the node's owner.
                  </>
                )}
              </p>
            </div>
          )}

          {ownsNode && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="section-title">Contribution</div>
              <p className="muted" style={{ margin: '2px 0 12px' }}>
                Choose how much of this machine you lend to the network. Limits are enforced — the
                node won't host past your caps.
              </p>
              {adminReq && (
                <div className="field wide">
                  <label htmlFor="o-admin">Admin token</label>
                  <input
                    id="o-admin"
                    type="password"
                    value={admin}
                    onChange={(ev) => rememberAdmin(ev.target.value)}
                    placeholder="required to change limits"
                  />
                </div>
              )}
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="o-ram">Max RAM to contribute (GB)</label>
                  <input
                    id="o-ram"
                    value={maxRamGb}
                    onChange={(ev) => {
                      setMaxRamGb(ev.target.value);
                      setTouched(true);
                    }}
                  />
                  <span className="hint">0 = no cap</span>
                </div>
                <div className="field">
                  <label htmlFor="o-agents">Max agents to host</label>
                  <input
                    id="o-agents"
                    value={maxAgents}
                    onChange={(ev) => {
                      setMaxAgents(ev.target.value);
                      setTouched(true);
                    }}
                  />
                  <span className="hint">0 = no cap</span>
                </div>
                <div className="field">
                  <label htmlFor="o-contrib">Offer spare compute</label>
                  <select
                    id="o-contrib"
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
                <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>
                  {msg.text}
                </div>
              )}
            </div>
          )}

          {/* Node-owner cards — shown to whoever RUNS this node. Economics + Storage stay admin-only
              (network monetary policy + node persistence config, not per-operator). */}
          {ownsNode && <HostingCard />}

          {ownsNode && <AuthorityCard role={node.role} />}

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
