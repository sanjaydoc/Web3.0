import { useRef, useState } from 'react';
import {
  ApiError,
  type GenesisAsk,
  type GenesisConfig,
  type GenesisTurn,
  type HostedAgent,
  NODE_URL,
  api,
  fileToBase64,
  setWeb3Token,
} from './api.js';
import { type AccountKey, generateAccountKey, saveAccountKey } from './txsign.js';

// Providers whose CREATED agent needs an API key entered at create time (never in the transcript).
const KEYED_AGENT_PROVIDERS = new Set(['openai', 'openrouter', 'anthropic', 'groq', 'gemini']);

// Default model per provider when the brain names a provider but forgets the model. `tunnel` stays ''
// (the node coerces it to the network default) — mirrors GenesisChat's launch defaulting.
const DEFAULT_MODEL: Record<string, string> = {
  tunnel: 'qwen2.5:3b',
  local: 'qwen2.5:7b',
  anthropic: 'claude-sonnet-5',
  openrouter: 'anthropic/claude-3.5-sonnet',
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
};

// Files stageable into the new agent's RAG (same set the dashboard Genesis chat accepts).
const KB_TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|html?|xml|yaml|yml)$/i;
const KB_DOC_EXT = /\.(pdf|docx|xlsx)$/i;
const KB_ACCEPT =
  '.pdf,.docx,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.log,.html,.htm,.xml,.yaml,.yml';

/** Derive a clean, distinct owner handle from the agent's handle (kept out of the agent's own
 *  web3Id namespace by the `-owner` suffix). `seed` (a retry counter) disambiguates collisions. */
function ownerHandleFrom(agentHandle: string, seed = 0): string {
  const base =
    (agentHandle || 'agent')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 20) || 'agent';
  return seed === 0 ? `${base}-owner` : `${base}-owner-${seed}`;
}

const clean = (s?: string) => (typeof s === 'string' && s.trim() ? s.trim() : undefined);

/**
 * LandingGenesis — the landing-page "create your agent" widget (the acquisition front door). An
 * UNAUTHENTICATED visitor designs an agent by chatting with the SAME Genesis brain (Claude Sonnet)
 * the dashboard uses, over the public `/genesis/public-chat` interview endpoint. On confirm it:
 *   1. mints them a real `agent-owner` account (ML-DSA key generated client-side, handle DERIVED from
 *      the agent's name), signing them in;
 *   2. launches the agent through the identical `/hosted/launch` path the dashboard uses — so the
 *      agent is byte-identical to a Genesis-chat/Genesis-new-agent one (Agents, x402, ERC-8004,
 *      billing, marketplace, placement all apply automatically — nothing "lite");
 *   3. reveals the agent's address + free/x402 endpoints and the owner's Web4.0 id + login key, with a
 *      one-click path into their dashboard.
 * Strictly follows the landing canvas theme (reuses the `.gchat-*` / `.chip-*` classes + `.l-*` tokens).
 */
export function LandingGenesis({ onEnter }: { onEnter: () => void }) {
  const [messages, setMessages] = useState<GenesisTurn[]>([]);
  const [config, setConfig] = useState<GenesisConfig>({});
  const [ask, setAsk] = useState<GenesisAsk | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [multiPick, setMultiPick] = useState<string[]>([]);
  const [error, setError] = useState('');

  // Create-time secret for a keyed provider (openai/anthropic/…) — held only in this field.
  const [agentKey, setAgentKey] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [launching, setLaunching] = useState(false);

  // Files attached during the interview → flushed into the new agent's knowledge base on launch.
  const [pendingFiles, setPendingFiles] = useState<
    { name: string; text?: string; dataBase64?: string }[]
  >([]);
  const [kbNote, setKbNote] = useState('');

  // The minted account (persist across a retry so a failed launch doesn't create a second account).
  const acct = useRef<{ address: string; token: string; key: AccountKey } | null>(null);
  const [created, setCreated] = useState<HostedAgent | null>(null);
  const [copied, setCopied] = useState<string>('');
  const scroller = useRef<HTMLDivElement | null>(null);

  const needsAgentKey = Boolean(config.provider && KEYED_AGENT_PROVIDERS.has(config.provider));

  const scrollDown = () =>
    requestAnimationFrame(() =>
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }),
    );

  async function turn(next: GenesisTurn[]) {
    setSending(true);
    setError('');
    setAsk(null);
    setMultiPick([]);
    try {
      const r = await api.genesisPublicChat(next);
      const assistant: GenesisTurn = { role: 'assistant', content: r.reply || '…' };
      const convo = [...next, assistant];
      setMessages(convo);
      const merged = { ...config, ...(r.config ?? {}) };
      setConfig(merged);
      setAsk(r.ask ?? null);

      // Auto-create the moment the brain confirms (done=true) — same as the dashboard chat. Keyed
      // providers still need their secret first, so those wait for the Create button + key field.
      if (r.done === true && !created && !launching) {
        const keyed = Boolean(merged.provider && KEYED_AGENT_PROVIDERS.has(merged.provider));
        const p = priceInput.trim();
        const priceUsd = p === '' ? merged.priceUsd : Math.max(0, Number(p) || 0);
        if (merged.handle && (!keyed || agentKey.trim())) {
          await launch({ ...merged, priceUsd });
        }
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'You’re going a little fast — give it a few seconds and try again.'
          : err instanceof Error
            ? err.message
            : String(err),
      );
      setMessages(next); // keep the user's turn even if the brain call failed
    } finally {
      setSending(false);
      scrollDown();
    }
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || sending || launching) return;
    setInput('');
    void turn([...messages, { role: 'user', content: t }]);
  }

  function pickOption(value: string, label: string) {
    if (ask?.multi) {
      setMultiPick((p) => (p.includes(value) ? p.filter((x) => x !== value) : [...p, value]));
      return;
    }
    send(label);
  }
  function submitMulti() {
    if (!ask) return;
    const chosen = ask.options?.filter((o) => multiPick.includes(o.value)) ?? [];
    send(chosen.length ? chosen.map((o) => o.label).join(', ') : 'none');
  }

  async function attachFiles(files: FileList) {
    const accepted: { name: string; text?: string; dataBase64?: string }[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      if (KB_DOC_EXT.test(file.name))
        accepted.push({ name: file.name, dataBase64: await fileToBase64(file) });
      else if (KB_TEXT_EXT.test(file.name))
        accepted.push({ name: file.name, text: await file.text() });
      else rejected.push(file.name);
    }
    if (accepted.length) setPendingFiles((p) => [...p, ...accepted]);
    setKbNote(
      rejected.length
        ? `Attached ${accepted.length} file(s). Skipped ${rejected.join(', ')} — upload PDF, Word (.docx), Excel (.xlsx), or text files.`
        : `Attached ${accepted.length} file(s) — I’ll add these to your agent’s knowledge when it’s created.`,
    );
  }
  function removePending(name: string) {
    setPendingFiles((p) => p.filter((f) => f.name !== name));
  }

  /** Mint the visitor's agent-owner account (idempotent — reuses one already minted this session).
   *  Derives the handle from the agent, retrying with a suffix if the handle is taken. */
  async function ensureAccount(agentHandle: string): Promise<{ address: string; token: string }> {
    if (acct.current) return acct.current;
    let lastErr: unknown = null;
    for (let seed = 0; seed < 6; seed++) {
      const handle = ownerHandleFrom(agentHandle, seed);
      const key = generateAccountKey();
      try {
        const res = await api.signup(handle, 'agent-owner', key.publicKey);
        saveAccountKey(res.address, key);
        setWeb3Token(res.token); // sign the visitor in so /hosted/launch is authenticated
        localStorage.setItem('web3.creatorName', res.address);
        acct.current = { address: res.address, token: res.token, key };
        return acct.current;
      } catch (err) {
        lastErr = err;
        // Retry only on a handle collision; anything else (network, node error) is fatal.
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!/taken|exist|already|duplicate/.test(msg)) throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('could not create your account');
  }

  async function launch(cfgArg?: GenesisConfig) {
    const cfg = cfgArg ?? config;
    if (!cfg.handle || launching || created) return;
    setLaunching(true);
    setError('');
    try {
      await ensureAccount(cfg.handle); // mints + signs in the owner (acct.current), used in the reveal
      const provider = clean(cfg.provider) ?? 'tunnel';
      const model = clean(cfg.model) ?? DEFAULT_MODEL[provider] ?? '';
      const price = cfg.priceUsd !== undefined ? Math.max(0, Math.round(cfg.priceUsd * 100)) : 0;
      const agent = await api.hostedLaunch({
        handle: cfg.handle,
        name: cfg.name ?? cfg.handle,
        description: cfg.description ?? '',
        skillId: cfg.skillId ?? 'ask',
        skillName: cfg.skillName ?? 'Ask',
        skillDesc: cfg.skillDesc ?? 'Answer a question',
        price,
        provider,
        model,
        apiKey: agentKey.trim() || undefined,
        system: cfg.system,
        connectors: cfg.connectors,
      });
      setAgentKey('');
      // Flush attached files into the new agent's RAG knowledge base before revealing.
      if (pendingFiles.length) {
        let ok = 0;
        for (const f of pendingFiles) {
          try {
            await api.addKnowledge(agent.web3Id, {
              kind: 'file',
              filename: f.name,
              title: f.name,
              ...(f.dataBase64 ? { dataBase64: f.dataBase64 } : { text: f.text }),
            });
            ok++;
          } catch {
            /* keep going — a failed doc can be re-added in the dashboard */
          }
        }
        setPendingFiles([]);
        setKbNote(ok ? `Indexed ${ok} document${ok === 1 ? '' : 's'} into ${agent.name}.` : '');
      }
      setCreated(agent);
      scrollDown();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }

  function copy(id: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? '' : c)), 1500);
  }

  function downloadCredentials() {
    if (!acct.current || !created) return;
    const blob = new Blob(
      [
        [
          'Web4.0 — keep this file safe. It is the ONLY copy of your login credentials.',
          '',
          `Web4.0 id (your address): ${acct.current.address}`,
          `Login token (sign in with this): ${acct.current.token}`,
          '',
          `Agent: ${created.web3Id}`,
          `Free endpoint: ${NODE_URL}/agents/${created.web3Id}/ask`,
          ...((created.price ?? 0) > 0 && created.skill
            ? [`x402 paid endpoint: ${NODE_URL}/x402/call/${created.web3Id}/${created.skill}`]
            : []),
          '',
          'Signing key (ML-DSA-65, base64url) — for signing transactions:',
          `publicKey: ${acct.current.key.publicKey}`,
          `secretKey: ${acct.current.key.secretKey}`,
        ].join('\n'),
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `web4-credentials-${acct.current.address.split('@')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const priced = created ? (created.price ?? 0) > 0 && Boolean(created.skill) : false;
  const canCreate = Boolean(config.handle) && !created;

  return (
    <section className="l-genesis" aria-label="Create your agent">
      <div className="lg-head">
        <span className="l-eyebrow">Genesis · the self-building internet</span>
        <h2 className="lg-title">
          The self-building internet.
          <br />
          Describe an agent — it builds itself, live.
        </h2>
        <p className="lg-sub">
          Chat in plain language and Genesis creates a real, fully-operational agent — its own
          identity, wallet, x402 pay-per-call endpoint, and ERC-8004 reputation, placed on the
          network and billing from the first call. You get a Web4.0 login on the spot to manage it.
          No sign-up first.
        </p>
      </div>

      <div className="l-card lg-card">
        <div className="gchat-thread">
          <div className="gchat-scroll" ref={scroller}>
            {messages.length === 0 && (
              <div className="gchat-empty muted">
                <p>Hi — I’m Genesis. Tell me what your agent should do and I’ll build it.</p>
                <div className="chip-pick">
                  {[
                    'A support bot for my online store',
                    'An FAQ agent for my business',
                    'A paid research assistant',
                    'A lead-qualifying agent for my website',
                  ].map((s) => (
                    <button type="button" key={s} className="chip-toggle" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript, index is stable
                key={i}
                className={`gchat-msg ${m.role === 'user' ? 'gchat-user' : 'gchat-bot'}`}
              >
                <div className="gchat-bubble">{m.content}</div>
              </div>
            ))}
            {(sending || launching) && (
              <div className="gchat-msg gchat-bot">
                <div className="gchat-bubble gchat-typing" aria-label="Genesis is thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {ask?.options?.length && !created ? (
            <div className="gchat-asks">
              <div className="chip-pick">
                {ask.options.map((o) => {
                  const recommended = /\(recommended\)/i.test(o.label);
                  return (
                    <button
                      type="button"
                      key={o.value}
                      className={`chip-toggle ${ask.multi && multiPick.includes(o.value) ? 'on' : ''} ${recommended ? 'recommended' : ''}`}
                      onClick={() => pickOption(o.value, o.label)}
                    >
                      {ask.multi && multiPick.includes(o.value) ? '✓ ' : ''}
                      {recommended ? '★ ' : ''}
                      {o.label}
                    </button>
                  );
                })}
              </div>
              {ask.multi && (
                <button type="button" className="chip-toggle" onClick={submitMulti}>
                  Continue
                </button>
              )}
            </div>
          ) : null}

          {pendingFiles.length > 0 && !created && (
            <div className="gchat-attachments">
              {pendingFiles.map((f) => (
                <span key={f.name} className="chip gchat-file-chip">
                  {f.name}
                  <button
                    type="button"
                    className="gchat-file-x"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => removePending(f.name)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {!created && (
            <form
              className="gchat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <label className="gchat-attach" title="Attach files for your agent's knowledge (RAG)">
                <svg
                  viewBox="0 0 448 512"
                  width="16"
                  height="16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M364.2 83.8c-24.4-24.4-64-24.4-88.4 0l-184 184c-42.1 42.1-42.1 110.3 0 152.4s110.3 42.1 152.4 0l152-152c10.9-10.9 28.7-10.9 39.6 0s10.9 28.7 0 39.6l-152 152c-64 64-167.6 64-231.6 0s-64-167.6 0-231.6l184-184c46.3-46.3 121.3-46.3 167.6 0s46.3 121.3 0 167.6l-176 176c-28.6 28.6-75 28.6-103.6 0s-28.6-75 0-103.6l144-144c10.9-10.9 28.7-10.9 39.6 0s10.9 28.7 0 39.6l-144 144c-6.7 6.7-6.7 17.7 0 24.4s17.7 6.7 24.4 0l176-176c24.4-24.4 24.4-64 0-88.4z" />
                </svg>
                <input
                  type="file"
                  multiple
                  accept={KB_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files?.length) void attachFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <input
                type="text"
                placeholder={sending ? 'Genesis is thinking…' : 'Message Genesis…'}
                value={input}
                disabled={sending || launching}
                onChange={(e) => setInput(e.target.value)}
              />
              <button
                type="submit"
                className="l-go lg-send"
                disabled={sending || launching || !input.trim()}
              >
                Send
              </button>
            </form>
          )}

          {/* Create bar: appears once the agent has a handle. Auto-fires on the brain's confirm; the
              button is the manual path (and the only path for keyed providers needing an API key). */}
          {canCreate && (
            <div className="lg-createbar">
              {needsAgentKey && (
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={`${config.provider} API key (stored on the node, never shown again)`}
                  value={agentKey}
                  onChange={(e) => setAgentKey(e.target.value)}
                  className="lg-key"
                />
              )}
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Price per call (USD) — 0 = free"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="lg-price"
              />
              <button
                type="button"
                className="l-go"
                disabled={launching || !config.handle || (needsAgentKey && !agentKey.trim())}
                onClick={() => {
                  const p = priceInput.trim();
                  const priceUsd = p === '' ? config.priceUsd : Math.max(0, Number(p) || 0);
                  void launch({ ...config, priceUsd });
                }}
              >
                {launching ? 'Creating your agent…' : `Create ${config.name ?? config.handle}`}
              </button>
            </div>
          )}
        </div>

        {kbNote && !error && <p className="lg-note ok">{kbNote}</p>}
        {error && <p className="lg-note err">{error}</p>}

        {/* ─── Reveal: the created agent + the owner's brand-new login, in the canvas theme ─── */}
        {created && acct.current && (
          <div className="lg-reveal">
            <div className="lg-reveal-head">
              <span className="lg-badge-live">● Live</span>
              <b>{created.name} is running on the network</b>
            </div>

            <div className="lg-grid">
              <CredRow
                label="Agent address"
                value={created.web3Id}
                onCopy={() => copy('web3Id', created.web3Id)}
                copied={copied === 'web3Id'}
              />
              <CredRow
                label="Free endpoint"
                value={`${NODE_URL}/agents/${created.web3Id}/ask`}
                onCopy={() => copy('ask', `${NODE_URL}/agents/${created.web3Id}/ask`)}
                copied={copied === 'ask'}
              />
              {priced && (
                <CredRow
                  label="x402 paid endpoint"
                  value={`${NODE_URL}/x402/call/${created.web3Id}/${created.skill}`}
                  onCopy={() =>
                    copy('x402', `${NODE_URL}/x402/call/${created.web3Id}/${created.skill}`)
                  }
                  copied={copied === 'x402'}
                />
              )}
            </div>

            <div className="lg-login">
              <div className="lg-login-head">
                <b>Your Web4.0 login</b>
                <span>Save this — it’s how you sign in to manage your agent. Shown once.</span>
              </div>
              <div className="lg-grid">
                <CredRow
                  label="Your Web4.0 id"
                  value={acct.current.address}
                  onCopy={() => copy('addr', acct.current?.address ?? '')}
                  copied={copied === 'addr'}
                />
                <CredRow
                  label="Login key (token)"
                  value={acct.current.token}
                  secret
                  onCopy={() => copy('tok', acct.current?.token ?? '')}
                  copied={copied === 'tok'}
                />
              </div>
              <div className="lg-actions">
                <button type="button" className="lg-ghost" onClick={downloadCredentials}>
                  ↓ Download credentials
                </button>
                <button type="button" className="l-go lg-enter" onClick={onEnter}>
                  Enter your dashboard →
                </button>
              </div>
            </div>

            <p className="lg-fund-note">
              Your agent earns USDC every time someone calls it over x402, paid straight into your
              wallet. That wallet also covers its hosting rent — so fund it with a little USDC (or
              let x402 earnings build it up) to keep your agent hosted and running.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** One labelled credential/endpoint row with a copy button — canvas mono styling. */
function CredRow({
  label,
  value,
  onCopy,
  copied,
  secret,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  secret?: boolean;
}) {
  const shown = secret
    ? `${value.slice(0, 8)}${'•'.repeat(Math.max(6, value.length - 12))}${value.slice(-4)}`
    : value;
  return (
    <div className="lg-row">
      <span className="lg-row-lbl">{label}</span>
      <div className="lg-row-val">
        <code>{shown}</code>
        <button type="button" className="lg-copy" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
