import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type HostServedRow,
  type LlmOffer,
  type LocalModel,
  NODE_URL,
  type RamDetect,
  api,
  formatAmount,
} from './api.js';

const gb = (mb: number) => (mb / 1024).toFixed(1);

// Hosting a model runs on the operator's OWN machine (its local Ollama), so this section is only
// meaningful when the dashboard is driving a LOCAL node — i.e. the desktop or mobile app. On the
// website the dashboard talks to a shared/remote node, so hosting is disabled (it would just read
// the server's RAM, not yours). Desktop builds ship the bridge; native apps talk to 127.0.0.1.
const IS_NATIVE_HOST =
  typeof window !== 'undefined' &&
  (Boolean((window as { web3desktop?: unknown }).web3desktop) ||
    NODE_URL.includes('127.0.0.1') ||
    NODE_URL.includes('localhost'));

/**
 * Host LLM tunnel — the node operator's dedicated section for selling inference. The operator
 * publishes the local models they host (Ollama tags) and the price they charge per million tokens;
 * each offer is tunnel-served so an agent owner can pick it as a hosted brain from the Marketplace.
 * The table shows every model this node hosts, its live traffic (tokens served) and earnings.
 */
export function LlmTunnel() {
  const [offers, setOffers] = useState<LlmOffer[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [usage, setUsage] = useState<HostServedRow[]>([]);
  const [model, setModel] = useState('');
  const [price, setPrice] = useState('');
  const [ram, setRam] = useState('');
  const [ctx, setCtx] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [detect, setDetect] = useState<RamDetect | null>(null);
  const [local, setLocal] = useState<{ available: boolean; models: LocalModel[] } | null>(null);
  const [scanBusy, setScanBusy] = useState<'ram' | 'models' | null>(null);
  const [chatModel, setChatModel] = useState<string | null>(null);
  // Network inference price ceiling (admin monetary policy), USDC minor per Mtok. 0/null = no cap.
  const [priceCap, setPriceCap] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [offersRes, rev, eco] = await Promise.all([
        api.llmOffers(),
        api.llmRevenue(),
        api.economics().catch(() => null),
      ]);
      setOffers(offersRes.offers);
      setRevenue(rev.revenue);
      setUsage(rev.usage);
      if (eco) setPriceCap(eco.maxInferencePriceMTok);
    } catch {
      /* offline / not signed in — keep last */
    }
  }, []);

  useEffect(() => {
    if (!IS_NATIVE_HOST) return; // don't poll a shared node's data on the website
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

  // Detect free RAM on this machine and pre-fill the form with the model that fits it.
  const detectRam = async () => {
    setScanBusy('ram');
    setMsg(null);
    try {
      const d = await api.llmDetect();
      setDetect(d);
      if (d.recommended) {
        setModel(d.recommended.model);
        setRam(gb(d.recommended.ramMb));
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setScanBusy(null);
    }
  };

  // List models the operator already pulled locally with Ollama.
  const scanLocal = async () => {
    setScanBusy('models');
    setMsg(null);
    try {
      setLocal(await api.llmLocalModels());
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setScanBusy(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Host LLM tunnel</h1>
        <span className="muted">host local models and sell inference over the network</span>
      </div>

      {!IS_NATIVE_HOST && (
        <div
          className="card"
          style={{ marginBottom: 18, borderLeft: '3px solid var(--no)' }}
        >
          <div className="section-title">Available in the desktop &amp; mobile app</div>
          <p className="muted" style={{ margin: '2px 0 12px' }}>
            Hosting a model runs on <b>your own machine's</b> local models (Ollama). The website is
            connected to a shared network node, so hosting is disabled here — it can't reach your
            computer. Open the Web3.0 <b>desktop</b> (or mobile) app to host a model and earn.
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
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="section-title">Sell inference</div>
          <p className="muted" style={{ margin: '2px 0 12px' }}>
            Host local models on this machine and sell inference over the relay. Each model you
            publish appears in the agent-owner Marketplace as a hosted brain. Runs your node's local
            model client (Ollama) — pull the tag first, then publish it here.
          </p>
          <dl className="kv">
            <dt>Inference revenue (accrued)</dt>
            <dd>{formatAmount(revenue)}</dd>
            <dt>Models hosted</dt>
            <dd>{offers.length}</dd>
          </dl>

          {/* One-click helpers: size a model to free RAM, or reuse a model already pulled locally. */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '4px 0 12px' }}>
            <button type="button" className="btn" disabled={scanBusy !== null} onClick={detectRam}>
              {scanBusy === 'ram' ? 'Detecting…' : 'Detect free RAM → suggest model'}
            </button>
            <button type="button" className="btn" disabled={scanBusy !== null} onClick={scanLocal}>
              {scanBusy === 'models' ? 'Scanning…' : 'Detect installed Ollama models'}
            </button>
          </div>

          {/* Pricing reference — the price field is in USDC MINOR units per million tokens
              (100 minor = 1.00 USDC). This chart maps what you enter to the real per-Mtok rate,
              and shows the network ceiling an offer can't exceed. */}
          <div className="card" style={{ margin: '4px 0 14px', padding: '12px 14px' }}>
            <div className="section-title" style={{ marginBottom: 6 }}>
              Pricing guide · USDC minor per Mtok
            </div>
            <div className="hscroll">
              <table>
                <thead>
                  <tr>
                    <th>You enter</th>
                    <th>Shows as</th>
                    <th>Per 1M tokens</th>
                    <th>Feel</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { minor: 0, feel: 'Free — reputation / adoption play' },
                    { minor: 10, feel: 'Budget small model' },
                    { minor: 50, feel: 'Typical small model' },
                    { minor: 100, feel: 'Premium small / mid model' },
                    { minor: 500, feel: 'Large / high-demand model' },
                  ].map((r) => {
                    const overCap = priceCap !== null && priceCap > 0 && r.minor > priceCap;
                    return (
                      <tr key={r.minor} style={overCap ? { opacity: 0.45 } : undefined}>
                        <td>
                          <strong>{r.minor}</strong>
                        </td>
                        <td>{r.minor === 0 ? 'free' : `${formatAmount(r.minor)} USDC`}</td>
                        <td>{r.minor === 0 ? '$0.00' : `$${(r.minor / 100).toFixed(2)}`}</td>
                        <td className="muted">
                          {r.feel}
                          {overCap ? ' · over cap' : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              {priceCap !== null && priceCap > 0 ? (
                <>
                  Network cap: <b>{priceCap}</b> ({formatAmount(priceCap)} USDC/Mtok). Offers above
                  this are rejected — set by the network admin in Revenue.
                </>
              ) : (
                <>No network price cap is set — you may price freely.</>
              )}{' '}
              You keep the operator share; the platform commission comes off the top per the current
              Revenue split.
            </p>
          </div>

          {detect && (
            <div className="note note-ok" style={{ marginBottom: 12 }}>
              {gb(detect.freeMb)} GB free of {gb(detect.systemMb)} GB total.{' '}
              {detect.recommended ? (
                <>
                  Suggested: <b>{detect.recommended.model}</b> ({detect.recommended.label}) — filled
                  in below. Pull it with <code>ollama pull {detect.recommended.model}</code>, then
                  Publish.
                </>
              ) : (
                <>
                  Not enough free RAM for a local model right now — free some up, or host a tiny 2B
                  tag.
                </>
              )}
            </div>
          )}

          {local && (
            <div className="note" style={{ marginBottom: 12 }}>
              {local.available ? (
                local.models.length > 0 ? (
                  <>
                    <div style={{ marginBottom: 6 }}>
                      Models already on this machine — click to use:
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {local.models.map((m) => (
                        <button
                          key={m.name}
                          type="button"
                          className="btn ghost"
                          style={{ padding: '4px 10px' }}
                          onClick={() => setModel(m.name)}
                        >
                          {m.name}
                          {m.sizeMb > 0 && <span className="muted"> · {gb(m.sizeMb)} GB</span>}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    Ollama is running but no models are pulled yet. Try{' '}
                    <code>ollama pull qwen2.5:3b</code>.
                  </>
                )
              ) : (
                <>
                  Ollama isn't reachable on this machine. Install it from <b>ollama.com</b>, then
                  click again.
                </>
              )}
            </div>
          )}

          <div className="form-grid">
            <div className="field">
              <label htmlFor="llm-model">Model tag</label>
              <input
                id="llm-model"
                value={model}
                placeholder="qwen2.5:3b"
                list="llm-model-suggestions"
                onChange={(e) => setModel(e.target.value)}
              />
              <datalist id="llm-model-suggestions">
                <option value="gemma2:2b">Gemma 2 · 2B — tiny, ~2 GB</option>
                <option value="qwen2.5:3b">Qwen2.5 · 3B — light default, ~2 GB</option>
                <option value="llama3.2:3b">Llama 3.2 · 3B — ~2 GB</option>
                <option value="phi3:mini">Phi-3 mini · 3.8B — ~2.3 GB</option>
                <option value="mistral:7b">Mistral · 7B — ~4.5 GB</option>
                <option value="qwen2.5:7b">Qwen2.5 · 7B — ~4.7 GB</option>
                <option value="llama3.1:8b">Llama 3.1 · 8B — ~5 GB</option>
                <option value="qwen2.5:14b">Qwen2.5 · 14B — ~9 GB</option>
              </datalist>
              <span className="hint">
                Pick a suggestion or type any Ollama tag. Pull it first:{' '}
                <code>ollama pull &lt;tag&gt;</code>
              </span>
            </div>
            <div className="field">
              <label htmlFor="llm-price">Price / Mtok (USDC minor)</label>
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
          <p className="muted" style={{ margin: '2px 0 12px' }}>
            Tokens your machine has served over the tunnel and what you've earned — a usage meter
            that fills in as agents (on this or any other node) run on your models. Earnings accrue
            at your offered price the moment you serve (0.00 for a free model); the agent owner's
            node settles the charge, and your wallet balance reflects what has actually paid out.
          </p>
          {offers.length === 0 ? (
            <div className="empty">
              You're not hosting any models yet. Pull a light one with{' '}
              <code>ollama pull qwen2.5:3b</code>, then publish it above.
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
                    <th>Earned (accrued)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {offers.map((o) => {
                    const traffic = usage.filter((u) => u.model === o.model);
                    const tokens = traffic.reduce((s, u) => s + u.servedTokens, 0);
                    const earned = traffic.reduce((s, u) => s + u.accruedEarnings, 0);
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
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => setChatModel(o.model)}
                            >
                              Test
                            </button>
                            <button
                              type="button"
                              className="btn"
                              disabled={busy}
                              onClick={() => remove(o.model)}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {chatModel && <ModelChat model={chatModel} onClose={() => setChatModel(null)} />}
      </div>
    </>
  );
}

/**
 * ModelChat — a quick chat panel so the operator can test a model they host, straight against their
 * own machine's Ollama (no tunnel, no agent, no payment). Confirms the GPU actually serves it.
 */
function ModelChat({ model, onClose }: { model: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<{ id: number; role: 'you' | 'model'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to newest whenever the log grows
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [msgs.length]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { id: nextId.current++, role: 'you', text: q }]);
    setInput('');
    setBusy(true);
    try {
      const { answer } = await api.testModel(model, q);
      setMsgs((m) => [...m, { id: nextId.current++, role: 'model', text: answer }]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        {
          id: nextId.current++,
          role: 'model',
          text: `${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
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
          Test · <span className="muted">{model}</span>
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
          <div className="muted">Chat with your hosted model to confirm it responds…</div>
        )}
        {msgs.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'you' ? 'flex-end' : 'flex-start',
              maxWidth: '82%',
              background: m.role === 'you' ? 'var(--accent)' : 'var(--hair)',
              color: m.role === 'you' ? '#fff' : 'inherit',
              padding: '8px 12px',
              borderRadius: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="muted" style={{ alignSelf: 'flex-start' }}>
            thinking…
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1 }}
          value={input}
          placeholder="Ask your model something…"
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
