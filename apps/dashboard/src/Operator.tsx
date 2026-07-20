import { useCallback, useEffect, useState } from 'react';
import {
  type AuthorityRequest,
  type Economics,
  type NodeLocation,
  type NodeOperator,
  type NodeRole,
  type StakeInfo,
  type StorageInfo,
  api,
  formatAmount,
} from './api.js';

/** Live monetary policy — visible to any signed-in operator, editable by the admin. */
function EconomicsCard() {
  const [eco, setEco] = useState<Economics | null>(null);
  const [feeBps, setFeeBps] = useState('');
  const [burnBps, setBurnBps] = useState('');
  const [rewardAeth, setRewardAeth] = useState('');
  const [stakeAeth, setStakeAeth] = useState('');
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
        setStakeAeth((e.authorityStake / 100).toString());
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
        authorityStake: Math.round(Number.parseFloat(stakeAeth || '0') * 100),
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
        The node's live monetary policy — fees fund operators, burns give aETH scarcity, the stake
        prices authority admission. Admin-only to change; applies without a restart.
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
        <div className="field">
          <label htmlFor="eco-stake">Authority stake (aETH)</label>
          <input
            id="eco-stake"
            value={stakeAeth}
            onChange={(ev) => setStakeAeth(ev.target.value)}
          />
          <span className="hint">permissionless admission threshold</span>
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

/** Two roads to authority: stake aETH (permissionless) or ask the admin (invite lane). */
function AuthorityCard({ role }: { role: NodeRole }) {
  const [mine, setMine] = useState<AuthorityRequest | null>(null);
  const [stake, setStake] = useState<StakeInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const refresh = () => {
    api
      .myAuthorityRequest()
      .then((r) => setMine(r.request))
      .catch(() => undefined);
    api
      .stakeInfo()
      .then(setStake)
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

  async function doStake() {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const res = await api.stake({});
      setOk(res.note);
      refresh();
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
          This node is in the authority set — it proposes and signs blocks, and earns block rewards.
        </p>
      </div>
    );
  }
  const remaining = stake ? Math.max(0, stake.threshold - stake.staked) : 0;
  const canAfford = stake ? stake.walletBalance >= remaining && remaining > 0 : false;
  const pct =
    stake && stake.threshold > 0 ? Math.min(100, (stake.staked / stake.threshold) * 100) : 0;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="section-title">Become an authority</div>
      <p className="muted" style={{ margin: '2px 0 14px' }}>
        Authority nodes sign the chain's blocks and earn block rewards. Two ways in — <b>stake</b>{' '}
        (permissionless, Ethereum-style) or <b>ask the admin</b> (invited). Either way the seating
        happens on-chain automatically.
      </p>

      <div className="section-title" style={{ fontSize: 'var(--fs-title)' }}>
        1 · Stake {stake?.thresholdFormatted ?? '…'}
      </div>
      {stake && (
        <>
          <p className="muted" style={{ margin: '0 0 8px' }}>
            Escrow <code>{stake.escrow}</code> holds <b>{stake.stakedFormatted}</b> for this node ·
            your wallet: <b>{formatAmount(stake.walletBalance)}</b>
            {stake.eligible && ' — threshold met, seating on-chain'}
          </p>
          <div
            style={{
              height: 8,
              borderRadius: 6,
              background: 'var(--hair)',
              overflow: 'hidden',
              marginBottom: 10,
              maxWidth: 420,
            }}
          >
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ok)' }} />
          </div>
          {stake.staked > 0 && (
            <button
              type="button"
              className="btn act"
              disabled={busy}
              style={{ marginRight: 8 }}
              onClick={async () => {
                setBusy(true);
                setErr('');
                setOk('');
                try {
                  const res = await api.unstake();
                  setOk(
                    res.cooldownMs > 0
                      ? `Exit requested — ${formatAmount(res.amount)} refunds after the ${Math.round(res.cooldownMs / 3_600_000)}h cooldown${res.removalQueued ? '; leaving the authority set on-chain' : ''}.`
                      : `Unstaked ${formatAmount(res.amount)} back to your wallet${res.removalQueued ? ' — leaving the authority set on-chain' : ''}.`,
                  );
                  refresh();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Unstake &amp; exit
            </button>
          )}
          {!stake.eligible && (
            <button
              type="button"
              className="btn act"
              disabled={busy || !canAfford}
              onClick={doStake}
            >
              {busy
                ? 'Staking…'
                : canAfford
                  ? `Stake ${formatAmount(remaining)} & join`
                  : `Need ${formatAmount(remaining)} — earn aETH to stake`}
            </button>
          )}
          {!stake.eligible && !canAfford && (
            <div style={{ marginTop: 12 }}>
              <div className="field-lbl" style={{ marginBottom: 4 }}>
                How to earn your stake
              </div>
              <ol className="steps">
                <li>
                  <b>Signup faucet</b> — {formatAmount(100_000)} to start (already in your wallet).
                </li>
                <li>
                  <b>Sell agent work</b> — launch agents in <b>Genesis</b> with an ask price; every
                  task another agent pays for lands aETH in your agents' wallets.
                </li>
                <li>
                  <b>Run this node well</b> — protocol fees (<code>WEB3_FEE_BPS</code>) on payments
                  it processes and hosting accrue to the node treasury; block rewards too once
                  you're an authority.
                </li>
                <li>
                  <b>Collect &amp; stake</b> — sweep treasury earnings into your wallet with{' '}
                  <b>Collect to wallet</b> (Earnings card, node owner), then stake here.
                </li>
              </ol>
            </div>
          )}
        </>
      )}

      <div className="section-title" style={{ fontSize: 'var(--fs-title)', marginTop: 16 }}>
        2 · Ask the admin
      </div>
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
      {ok && <div className="note note-ok">{ok}</div>}
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

  const useGps = () => {
    setMsg(null);
    if (!navigator.geolocation) {
      setMsg({
        kind: 'err',
        text: 'This browser has no geolocation — enter coordinates manually.',
      });
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(4));
        setLon(pos.coords.longitude.toFixed(4));
        setBusy(false);
        setMsg({ kind: 'ok', text: 'Location captured — press Save to publish it to the map.' });
      },
      (err) => {
        setBusy(false);
        setMsg({ kind: 'err', text: `Location denied or unavailable (${err.message}).` });
      },
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

export function Operator() {
  const [node, setNode] = useState<NodeOperator | null>(null);
  const [admin, setAdmin] = useState(() => localStorage.getItem(ADMIN_KEY) ?? '');
  const [adminReq, setAdminReq] = useState(false);
  const [contribute, setContribute] = useState(true);
  const [maxRamGb, setMaxRamGb] = useState('0');
  const [maxAgents, setMaxAgents] = useState('0');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [touched, setTouched] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const n = await api.node();
      setNode(n);
      if (!touched) {
        setContribute(n.limits.contribute);
        setMaxRamGb((n.limits.maxRamMb / 1024).toFixed(1).replace(/\.0$/, ''));
        setMaxAgents(String(n.limits.maxAgents));
      }
    } catch {
      /* node offline */
    }
    api
      .telegram()
      .then((t) => setAdminReq(t.adminRequired))
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
          My node{' '}
          {node && <span className={`role-badge ${node.role}`}>{node.role.toUpperCase()}</span>}
        </h1>
        <span className="muted">
          {node ? ROLE_HELP[node.role] : 'what this node earns, carries, and contributes to Web3.0'}
        </span>
      </div>

      {!node && (
        <div className="card empty">Node offline — start it to see live earnings and load.</div>
      )}

      {node && (
        <>
          <div className="grid-2" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="section-title">Earnings</div>
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
              </dl>
              {e && e.balance === 0 && (
                <p className="hint">
                  Earnings are off by default — set <code>WEB3_FEE_BPS</code> /{' '}
                  <code>WEB3_BLOCK_REWARD</code> to start earning.
                </p>
              )}
              {e && e.balance > 0 && (
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
          </div>

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

          <AuthorityCard role={node.role} />

          <EconomicsCard />

          <StorageCard />

          <NodeLocationCard />

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
        </>
      )}
    </>
  );
}
