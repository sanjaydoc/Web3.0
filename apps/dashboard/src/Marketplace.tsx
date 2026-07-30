import { useCallback, useEffect, useState } from 'react';
import {
  type Lease,
  type LlmMarketOffer,
  type LlmUsageRow,
  type MarketHost,
  api,
  formatAmount,
} from './api.js';
import { loadAccountKey, mandateNonce, signLeaseMandate } from './txsign.js';

/**
 * Marketplace — the agent-owner side of the compute marketplace. Browse hosts selling RAM capacity,
 * rent one to run an agent (creating a lease billed each epoch), and manage your active rentals. The
 * host earns the fee minus the platform commission; you pay from your wallet.
 */
export function Marketplace({ go }: { go?: (v: string) => void } = {}) {
  const [hosts, setHosts] = useState<MarketHost[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [models, setModels] = useState<LlmMarketOffer[]>([]);
  // Accrued inference cost (the usage-meter figure — populates even at 0 / with no balance).
  const [inferenceSpend, setInferenceSpend] = useState(0);
  // Per-agent hosted-brain usage rows (tokens consumed + accrued cost).
  const [usage, setUsage] = useState<LlmUsageRow[]>([]);
  const [agentId, setAgentId] = useState('');
  const [me, setMe] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, l, acct, brains, spend, use] = await Promise.all([
        api.hostingMarket(),
        api.hostingLeases(),
        api.me(),
        api.llmMarket(),
        api.llmSpend().catch(() => ({ spend: 0, accrued: 0 })),
        api.llmUsage().catch(() => ({ usage: [] as LlmUsageRow[] })),
      ]);
      setHosts(m.hosts);
      setLeases(l.leases);
      setMe(acct.address);
      setModels(brains.offers);
      // Show accrued cost — what usage has cost, whether or not it settled — so the meter isn't
      // stuck at 0 just because free models or empty wallets mean nothing was debited.
      setInferenceSpend(spend.accrued ?? 0);
      setUsage(use.usage);
    } catch {
      /* node offline — keep last */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const rent = async (h: MarketHost) => {
    const id = agentId.trim();
    if (!id) {
      setMsg({ kind: 'err', text: 'Enter the agent you want hosted (e.g. myagent@web3.0).' });
      return;
    }
    setBusy(h.host);
    setMsg(null);
    try {
      // Sign a lease mandate with the owner's ML-DSA key so every recurring debit is owner-authorized
      // and capped at the offered price. Falls back to an unsigned rental if the key isn't on this
      // device (e.g. signed in with only a token).
      const key = me ? loadAccountKey(me) : null;
      const mandate = key
        ? signLeaseMandate(key, {
            owner: me,
            host: h.host,
            agentId: id,
            maxPerEpoch: h.pricePerEpoch,
            maxEpochs: 0,
            expiry: '',
            nonce: mandateNonce(),
          })
        : undefined;
      await api.rentHost(id, mandate);
      setAgentId('');
      setMsg({
        kind: 'ok',
        text: mandate
          ? `Rented ${h.host} for ${id} — signed authorization; billed each epoch.`
          : `Rented ${h.host} for ${id} (no local key — unsigned). Billed each epoch.`,
      });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const end = async (id: string) => {
    setBusy(id);
    try {
      await api.endLease(id);
      await load();
    } catch {
      /* keep */
    } finally {
      setBusy(null);
    }
  };

  const rate = async (host: string, model: string, score: number) => {
    try {
      await api.rateLlm(host, model, score);
      await load();
    } catch {
      /* keep */
    }
  };

  // "Use this model": stash the tag and jump to Genesis, which preselects the tunnel brain + model.
  const useModel = (model: string) => {
    localStorage.setItem('web3.tunnelModel', model);
    go?.('genesis');
  };

  const mine = leases.filter((l) => l.active);

  return (
    <>
      <div className="page-head">
        <h1>Marketplace</h1>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Rent hosting for an agent</div>
        <div className="field" style={{ maxWidth: 360 }}>
          <label htmlFor="mkt-agent">Agent to host</label>
          <input
            id="mkt-agent"
            value={agentId}
            placeholder="myagent@web3.0"
            onChange={(e) => setAgentId(e.target.value)}
          />
        </div>
        {msg && (
          <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
        )}
        {hosts.length === 0 ? (
          <div className="empty">No hosts are offering capacity yet.</div>
        ) : (
          <div className="hscroll">
            <table>
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Price / epoch</th>
                  <th>Free capacity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hosts.map((h) => (
                  <tr key={h.host}>
                    <td>
                      <strong>{h.host}</strong>
                    </td>
                    <td>{formatAmount(h.pricePerEpoch)}</td>
                    <td>
                      {h.free} / {h.capacity || '∞'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn act"
                        disabled={busy === h.host || h.free === 0}
                        onClick={() => rent(h)}
                      >
                        {busy === h.host ? '…' : 'Rent'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Hosted models · pick a brain</div>
        <p className="muted" style={{ margin: '2px 0 12px' }}>
          Local LLMs that node operators host and sell inference for. Use one as your agent's brain
          by its <code>host</code> address — inference runs on their machine over the relay, billed
          per token.
        </p>
        <p className="hint">
          Operators are independent hosts: an <b>unverified</b> one has no ratings or passed canary
          checks yet, and it can see prompts it runs. Prefer higher-reputation hosts for sensitive
          work, and rate the models you use to help everyone.
        </p>
        <dl className="kv">
          <dt>Your inference cost</dt>
          <dd>{formatAmount(inferenceSpend)}</dd>
        </dl>
        {models.length === 0 ? (
          <div className="empty">No hosted models are on offer yet.</div>
        ) : (
          <div className="hscroll">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Host</th>
                  <th>Price / Mtok</th>
                  <th>Reputation</th>
                  <th>Rate it</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {models.map((o) => (
                  <tr key={`${o.host}:${o.model}`}>
                    <td>
                      <strong>{o.model}</strong>
                    </td>
                    <td className="mono-hash">{o.host}</td>
                    <td>{o.pricePerMTok > 0 ? formatAmount(o.pricePerMTok) : 'free'}</td>
                    <td>
                      {o.rep.verified ? (
                        <span
                          title={`${o.rep.ratingCount} rating(s), ${o.rep.canaryPass}/${o.rep.canaryTotal} canaries`}
                        >
                          {o.rep.score}/100
                          {o.rep.ratingCount > 0 && ` · ★${o.rep.avgRating}`}
                        </span>
                      ) : (
                        <span
                          className="muted"
                          title="No ratings or canary checks yet — trust unproven"
                        >
                          unverified
                        </span>
                      )}
                    </td>
                    <td>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className="btn ghost"
                          style={{ padding: '2px 6px' }}
                          onClick={() => rate(o.host, o.model, n)}
                          title={`Rate ${n}/5`}
                        >
                          {n}
                        </button>
                      ))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn act"
                        style={{ padding: '4px 10px' }}
                        onClick={() => useModel(o.model)}
                        title="Create an agent that uses this model as its brain"
                      >
                        Use this model
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Your rentals · agents on hosted brains</div>
        <p className="muted" style={{ margin: '2px 0 12px' }}>
          Every agent of yours running on a node operator's hosted model, the tokens it has
          consumed, and what that has cost — like a usage meter. It fills in as your agents run
          (0.00 for a free model); a paid model accrues cost each time an agent answers.
        </p>
        {usage.length === 0 ? (
          <div className="empty">
            No hosted-brain usage yet — run one of your agents (its model is served over the tunnel)
            and its usage appears here.
          </div>
        ) : (
          <div className="hscroll">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Model</th>
                  <th>Host</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={`${u.agentId ?? '—'}:${u.host}:${u.model}`}>
                    <td>
                      <strong>{u.agentId ?? '—'}</strong>
                    </td>
                    <td>{u.model}</td>
                    <td className="mono-hash">{u.host}</td>
                    <td>{(u.billedTokens + u.unbilledTokens).toLocaleString('en-US')}</td>
                    <td>{u.accruedCost > 0 ? formatAmount(u.accruedCost) : 'free'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {mine.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 18 }}>
              RAM hosting leases
            </div>
            <div className="hscroll">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Host</th>
                    <th>Price / epoch</th>
                    <th>Epochs</th>
                    <th>Paid</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {mine.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.agentId}</strong>
                      </td>
                      <td>{l.host}</td>
                      <td>{formatAmount(l.pricePerEpoch)}</td>
                      <td>{l.epochsBilled}</td>
                      <td>{formatAmount(l.paidTotal)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={busy === l.id}
                          onClick={() => end(l.id)}
                        >
                          {busy === l.id ? '…' : 'End'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
