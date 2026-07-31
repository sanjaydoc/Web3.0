import { useCallback, useEffect, useState } from 'react';
import { type HostingSummary, NODE_URL, api, formatAmount, ratePerHour } from './api.js';

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
function Contribution() {
  const [contribute, setContribute] = useState(true);
  const [maxRamGb, setMaxRamGb] = useState('0');
  const [maxAgents, setMaxAgents] = useState('0');
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
export function Hosting() {
  const [summary, setSummary] = useState<HostingSummary | null>(null);
  const [revenue, setRevenue] = useState(0);
  const [price, setPrice] = useState<number | null>(null); // the operator's set per-epoch rent price
  const [priceInput, setPriceInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [net, setNet] = useState<{ operators: number; freeSlots: number } | null>(null);
  // Epoch duration (ms) so rent shows as a human /hour rate (billing stays per-epoch under the hood).
  const [epochMs, setEpochMs] = useState(0);

  const load = useCallback(async () => {
    try {
      const [s, rev, offer, network] = await Promise.all([
        api.hostingSummary(),
        api.hostingRevenue().catch(() => null),
        api.hostingOffer().catch(() => null),
        api.hostingNetwork().catch(() => null),
      ]);
      setSummary(s);
      if (rev) setRevenue(rev.revenue);
      if (offer) setPrice(offer.pricePerEpoch);
      if (network) {
        setNet(network.totals);
        setEpochMs(network.epochMs || 0);
      }
    } catch {
      /* offline / not signed in — keep last */
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

  useEffect(() => {
    if (!IS_NATIVE_HOST) return; // don't poll a shared node's data on the website
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const cap = summary?.capacity;
  const capacityLabel =
    cap == null
      ? '—'
      : cap.cap > 0
        ? `${cap.used} / ${cap.cap} slots used`
        : 'not contributing RAM yet';
  const freeLabel = cap == null ? '—' : cap.free === null ? 'unlimited' : `${cap.free} slots free`;
  const hosted = summary?.hosted ?? [];

  return (
    <>
      <div className="page-head">
        <h1>Hosting · sell your RAM</h1>
        <span className="muted">run other people's agents on your machine and earn</span>
      </div>

      {!IS_NATIVE_HOST && (
        <div
          className="card"
          style={{ marginBottom: 18, borderLeft: '3px solid var(--no, #c0392b)' }}
        >
          <div className="section-title">Available in the desktop &amp; mobile app</div>
          <p className="muted" style={{ margin: '2px 0 12px' }}>
            Hosting agents runs on <b>your own machine's RAM</b>. The website is connected to a
            shared network node, so hosting is disabled here — it can't reach your computer. Open
            the Web3.0 <b>desktop</b> (or mobile) app to contribute RAM and earn.
          </p>
          <a
            className="btn act"
            href="https://github.com/sanjaydoc/Web3.0/releases/latest"
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
        <Contribution />

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="section-title">Your hosting capacity</div>
          <p className="muted" style={{ margin: '2px 0 12px' }}>
            Your contributed RAM becomes agent-hosting slots. Agent owners with no node of their own
            pay to run their agents on operators like you — the network auto-places their bodies
            onto whichever operator has a free slot. Set your contributed RAM in the{' '}
            <b>Run a node</b> quick-setup; more RAM = more slots = more you can earn.
          </p>
          <dl className="kv">
            <dt>Capacity</dt>
            <dd>{capacityLabel}</dd>
            <dt>Free</dt>
            <dd>{freeLabel}</dd>
            <dt>Hosting for others</dt>
            <dd>{hosted.length}</dd>
            <dt>Rent price</dt>
            <dd>{price === null ? '—' : price > 0 ? ratePerHour(price, epochMs) : 'free'}</dd>
            <dt>Rent earned</dt>
            <dd>{formatAmount(revenue)}</dd>
            <dt>Network capacity</dt>
            <dd>
              {net
                ? `${net.operators} other operator${net.operators === 1 ? '' : 's'} · ${net.freeSlots} slots free`
                : '—'}
            </dd>
          </dl>

          {/* Set the per-epoch rent this operator charges to run one agent body. 0 = free hosting. */}
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
              · billed each epoch, shown to renters per hour · you keep the operator share, the
              platform takes its commission
            </span>
          </div>
          {msg && (
            <p className={msg.kind === 'ok' ? 'ok' : 'err'} style={{ margin: '8px 0 0' }}>
              {msg.text}
            </p>
          )}
        </div>

        <div className="card">
          <div className="section-title">Agents you're hosting</div>
          {hosted.length === 0 ? (
            <div className="empty">
              You're not hosting any agents yet. When an owner's agent is placed on your node it
              shows here — make sure you've contributed RAM in <b>Run a node</b> and your node is
              online.
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
                    <th>Rent</th>
                  </tr>
                </thead>
                <tbody>
                  {hosted.map((a) => (
                    <tr key={a.web3Id}>
                      <td>
                        <strong>{a.name || a.handle}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {a.web3Id}
                        </div>
                      </td>
                      <td>{a.hostedForOwner ? shortKey(a.hostedForOwner) : '—'}</td>
                      <td>{a.model || '—'}</td>
                      <td>
                        <span className={a.running ? 'pill ok' : 'pill'}>
                          {a.running ? 'running' : 'stopped'}
                        </span>
                      </td>
                      <td>
                        {price && price > 0 ? (
                          ratePerHour(price, epochMs)
                        ) : (
                          <span className="muted">free</span>
                        )}
                      </td>
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
