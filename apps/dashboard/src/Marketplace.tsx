import { useCallback, useEffect, useState } from 'react';
import { type Lease, type LlmMarketOffer, type LlmUsageRow, api, formatAmount } from './api.js';

/**
 * Marketplace — the agent-owner side of the compute marketplace. Browse the hosted models node
 * operators sell inference for, pick one as an agent's brain, and watch a per-agent usage meter of
 * the tokens consumed and what they've cost. Inference runs on the operator's machine over the relay.
 */
export function Marketplace({ go }: { go?: (v: string) => void } = {}) {
  const [models, setModels] = useState<LlmMarketOffer[]>([]);
  // Accrued inference cost (the usage-meter figure — populates even at 0 / with no balance).
  const [inferenceSpend, setInferenceSpend] = useState(0);
  // Per-agent hosted-brain usage rows (tokens consumed + accrued cost).
  const [usage, setUsage] = useState<LlmUsageRow[]>([]);
  // Per-agent hosted-RAM rentals: the owner's agent bodies running on operators' RAM + rent paid.
  const [ramRentals, setRamRentals] = useState<Lease[]>([]);

  const load = useCallback(async () => {
    try {
      const [brains, spend, use, leaseRes, acct] = await Promise.all([
        api.llmMarket(),
        api.llmSpend().catch(() => ({ spend: 0, accrued: 0 })),
        api.llmUsage().catch(() => ({ usage: [] as LlmUsageRow[] })),
        api.hostingLeases().catch(() => ({ leases: [] as Lease[] })),
        api.me().catch(() => null),
      ]);
      setModels(brains.offers);
      // Show accrued cost — what usage has cost, whether or not it settled — so the meter isn't
      // stuck at 0 just because free models or empty wallets mean nothing was debited.
      setInferenceSpend(spend.accrued ?? 0);
      setUsage(use.usage);
      // My hosted-RAM rentals: leases where I'm the OWNER paying a host to run my agent's body
      // (not ones I host as an operator — those live on the Hosting page).
      setRamRentals(acct ? leaseRes.leases.filter((l) => l.owner === acct.address) : []);
    } catch {
      /* node offline — keep last */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

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

  return (
    <>
      <div className="page-head">
        <h1>Marketplace</h1>
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
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-title">Your rentals · agents on hosted RAM</div>
        <p className="muted" style={{ margin: '2px 0 12px' }}>
          Every agent of yours whose body runs on a node operator's contributed RAM, the host it's
          placed on, and the per-epoch rent it has accrued — like a usage meter. It fills in each
          epoch a placed agent runs (0.00 for a free host); a paid host accrues rent every epoch.
        </p>
        {ramRentals.length === 0 ? (
          <div className="empty">
            No hosted-RAM rentals yet — when one of your agents is placed on an operator's node it
            appears here with its rent. (No node of your own? The network auto-places your agents
            onto an operator with free capacity.)
          </div>
        ) : (
          <div className="hscroll">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Host</th>
                  <th>Rent / epoch</th>
                  <th>Epochs</th>
                  <th>Total rent</th>
                </tr>
              </thead>
              <tbody>
                {ramRentals.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.agentId}</strong>
                    </td>
                    <td className="mono-hash">{l.host}</td>
                    <td>
                      {l.pricePerEpoch > 0 ? `${formatAmount(l.pricePerEpoch)} / epoch` : 'free'}
                    </td>
                    <td>{l.epochsBilled.toLocaleString('en-US')}</td>
                    <td>{l.paidTotal > 0 ? formatAmount(l.paidTotal) : 'free'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
