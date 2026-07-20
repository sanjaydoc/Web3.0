import { useCallback, useEffect, useState } from 'react';
import { type NodeLocation, type NodeOperator, api, formatAmount } from './api.js';

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

  const e = node?.earnings;
  const r = node?.resources;
  const budgetMb =
    node && node.limits.maxRamMb > 0 ? node.limits.maxRamMb : (r?.systemTotalMb ?? 0);
  const ramPct = r && budgetMb ? Math.min(100, Math.round((r.processRssMb / budgetMb) * 100)) : 0;

  return (
    <>
      <div className="page-head">
        <h1>My node</h1>
        <span className="muted">what this node earns, carries, and contributes to Web3.0</span>
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
