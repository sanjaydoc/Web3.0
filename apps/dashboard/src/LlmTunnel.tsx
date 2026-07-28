import { useCallback, useEffect, useState } from 'react';
import { type LlmOffer, type LlmUsageRow, api, formatAmount } from './api.js';

/**
 * Host LLM tunnel — the node operator's dedicated section for selling inference. The operator
 * publishes the local models they host (Ollama tags) and the price they charge per million tokens;
 * each offer is tunnel-served so an agent owner can pick it as a hosted brain from the Marketplace.
 * The table shows every model this node hosts, its live traffic (tokens served) and earnings.
 */
export function LlmTunnel() {
  const [offers, setOffers] = useState<LlmOffer[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [usage, setUsage] = useState<LlmUsageRow[]>([]);
  const [model, setModel] = useState('');
  const [price, setPrice] = useState('');
  const [ram, setRam] = useState('');
  const [ctx, setCtx] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [offersRes, rev] = await Promise.all([api.llmOffers(), api.llmRevenue()]);
      setOffers(offersRes.offers);
      setRevenue(rev.revenue);
      setUsage(rev.usage);
    } catch {
      /* offline / not signed in — keep last */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const add = async () => {
    const m = model.trim();
    if (!m) {
      setMsg({ kind: 'err', text: 'Enter a model tag, e.g. llama3:8b.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.setLlmOffer({
        model: m,
        pricePerMTok: price ? Math.round(Number(price)) : undefined,
        ramMb: ram ? Math.round(Number(ram) * 1024) : undefined,
        maxContext: ctx ? Math.round(Number(ctx)) : undefined,
      });
      setModel('');
      setPrice('');
      setRam('');
      setCtx('');
      setMsg({ kind: 'ok', text: 'Model published to the marketplace.' });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.removeLlmOffer(m);
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Host LLM tunnel</h1>
        <span className="muted">host local models and sell inference over the network</span>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Sell inference</div>
        <p className="muted" style={{ margin: '2px 0 12px' }}>
          Host local models on this machine and sell inference over the relay. Each model you
          publish appears in the agent-owner Marketplace as a hosted brain. Runs your node's local
          model client (Ollama) — pull the tag first, then publish it here.
        </p>
        <dl className="kv">
          <dt>Inference revenue</dt>
          <dd>{formatAmount(revenue)}</dd>
          <dt>Models hosted</dt>
          <dd>{offers.length}</dd>
        </dl>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="llm-model">Model tag</label>
            <input
              id="llm-model"
              value={model}
              placeholder="llama3:8b"
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="llm-price">Price / Mtok (aETH minor)</label>
            <input
              id="llm-price"
              type="number"
              min={0}
              value={price}
              placeholder="0"
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="llm-ram">RAM (GB)</label>
            <input
              id="llm-ram"
              type="number"
              min={0}
              value={ram}
              placeholder="8"
              onChange={(e) => setRam(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="llm-ctx">Context (tokens)</label>
            <input
              id="llm-ctx"
              type="number"
              min={0}
              value={ctx}
              placeholder="4096"
              onChange={(e) => setCtx(e.target.value)}
            />
          </div>
        </div>
        <div className="gen-actions">
          <button type="button" className="btn act" disabled={busy} onClick={add}>
            {busy ? 'Publishing…' : 'Publish model'}
          </button>
        </div>
        {msg && (
          <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Your hosted models</div>
        {offers.length === 0 ? (
          <div className="empty">
            You're not hosting any models yet. Pull one with <code>ollama pull llama3:8b</code>,
            then publish it above.
          </div>
        ) : (
          <div className="hscroll">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Price / Mtok</th>
                  <th>RAM</th>
                  <th>Tokens served</th>
                  <th>Earned</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => {
                  const traffic = usage.filter((u) => u.model === o.model);
                  const tokens = traffic.reduce((s, u) => s + u.billedTokens, 0);
                  const earned = traffic.reduce((s, u) => s + u.earnedByHost, 0);
                  return (
                    <tr key={o.model}>
                      <td>
                        <strong>{o.model}</strong>
                      </td>
                      <td>{o.pricePerMTok > 0 ? formatAmount(o.pricePerMTok) : 'free'}</td>
                      <td>{o.ramMb > 0 ? `${(o.ramMb / 1024).toFixed(1)} GB` : '—'}</td>
                      <td>{tokens.toLocaleString()}</td>
                      <td>{formatAmount(earned)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => remove(o.model)}
                        >
                          Remove
                        </button>
                      </td>
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
