import { useEffect, useMemo, useRef, useState } from 'react';
import { KnowledgePanel } from './KnowledgePanel.js';
import {
  type CustomConnector,
  type GenesisAction,
  type GenesisAgentBrief,
  type GenesisAsk,
  type GenesisBrain,
  type GenesisConfig,
  type GenesisTurn,
  type HostedAgent,
  type HostedFullConfig,
  NODE_URL,
  api,
  fileToBase64,
} from './api.js';
import { uiConfirm } from './dialog.js';

const ADMIN_KEY = 'web3.adminToken';

// Brains the ADMIN may pick to power the chat. Keys live server-side only; the chat never sees them.
const BRAINS: { id: string; label: string; model: string; needsKey: boolean }[] = [
  { id: 'local', label: 'Local (Ollama) — free', model: 'qwen2.5:7b', needsKey: false },
  { id: 'anthropic', label: 'Anthropic Claude', model: 'claude-sonnet-5', needsKey: true },
  {
    id: 'openrouter',
    label: 'OpenRouter (many)',
    model: 'anthropic/claude-3.5-sonnet',
    needsKey: true,
  },
  { id: 'gemini', label: 'Google Gemini', model: 'gemini-2.0-flash', needsKey: true },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', needsKey: true },
  { id: 'groq', label: 'Groq', model: 'llama-3.3-70b-versatile', needsKey: true },
];

// Providers whose CREATED agent needs a key entered securely at create time (never in the transcript).
const KEYED_AGENT_PROVIDERS = new Set(['openai', 'openrouter', 'anthropic', 'groq', 'gemini']);

/** The agent's public call URL — x402 pay endpoint when priced, free /ask when not. */
function endpointFor(agent: HostedAgent): string {
  const priced = (agent.price ?? 0) > 0 && agent.skill;
  return priced
    ? `${NODE_URL}/x402/call/${agent.web3Id}/${agent.skill}`
    : `${NODE_URL}/agents/${agent.web3Id}/ask`;
}

/**
 * Compact one of the owner's hosted agents into the brief the brain uses for edit/test/FAQ. When we
 * have the agent's full config (fetched owner-only for the edit target), fold in its real skill fields
 * + system prompt so an edit preserves them verbatim instead of the brain re-inventing them.
 */
function toBrief(a: HostedAgent, full?: HostedFullConfig): GenesisAgentBrief {
  return {
    handle: a.handle,
    name: a.name,
    web3Id: a.web3Id,
    description: a.description,
    skill: a.skill,
    priceUsd: (a.price ?? 0) / 100,
    provider: a.provider,
    model: a.model,
    connectors: a.connectors,
    running: a.running,
    ...(full ? { skillName: full.skillName, skillDesc: full.skillDesc, system: full.system } : {}),
  };
}

// Files we can stage into a new agent's RAG: text-like ones read as text client-side; PDF/Word sent
// as base64 bytes for the node to extract (see docparse on the server).
const KB_TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|html?|xml|yaml|yml|rtf)$/i;
const KB_DOC_EXT = /\.(pdf|docx|xlsx)$/i;
const KB_ACCEPT =
  '.pdf,.docx,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.log,.html,.htm,.xml,.yaml,.yml,.rtf';

/** Best-effort human text from a hosted agent's ask output (shape varies by skill). */
function formatTestOutput(output: Record<string, unknown>): string {
  for (const k of ['answer', 'reply', 'text', 'output', 'result', 'message']) {
    const v = output[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return JSON.stringify(output).slice(0, 1200);
}

/**
 * GenesisChat — the conversational agent studio. An agent owner chats in plain language and the
 * admin-configured brain interviews them (one question at a time, with selectable chips) and assembles
 * a launch config live. On confirm it launches through the SAME `/hosted/launch` path the manual
 * Genesis form uses, so a chat-made agent is identical to a hand-made one: it shows up in Agents with
 * Start/Stop/Test/Copy-endpoint, rides the billing cycle, and gets x402 (priced skills) + ERC-8004
 * identity/reputation automatically. Scope is locked to create/edit/test/FAQ about agents. The brain
 * itself is set only by the admin (sanjay@web3.0).
 */
// localStorage key for the persisted chat transcript. Bump the suffix if GenesisTurn's shape changes.
const CHAT_STORAGE_KEY = 'web3.genesis.chat.v1';

export function GenesisChat({ isAdmin }: { isAdmin: boolean }) {
  const [brain, setBrain] = useState<GenesisBrain | null>(null);
  // The transcript persists across navigation AND app restarts (localStorage) so a testing session
  // isn't wiped when you leave the section. Restored lazily on mount; written back on every change.
  const [messages, setMessages] = useState<GenesisTurn[]>(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as GenesisTurn[]) : [];
    } catch {
      return [];
    }
  });
  const [config, setConfig] = useState<GenesisConfig>({});
  const [ask, setAsk] = useState<GenesisAsk | null>(null);
  const [done, setDone] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [multiPick, setMultiPick] = useState<string[]>([]);
  const [error, setError] = useState('');

  // Create-time secret for a keyed provider — held only in this field, sent once at launch.
  const [agentKey, setAgentKey] = useState('');
  const [launching, setLaunching] = useState(false);
  const [created, setCreated] = useState<HostedAgent | null>(null);
  const [createdWasEdit, setCreatedWasEdit] = useState(false); // captured at launch (agents refresh after)
  const [copied, setCopied] = useState(false);
  // Files the owner attaches DURING the interview, before the agent exists. Staged here (read as text
  // client-side), then flushed into the new agent's RAG knowledge base the moment it's created.
  const [pendingFiles, setPendingFiles] = useState<
    { name: string; text?: string; dataBase64?: string }[]
  >([]);
  const [kbNote, setKbNote] = useState('');

  // The owner's own agents — powers edit/test/FAQ (the brain gets a compact brief of these).
  const [agents, setAgents] = useState<HostedAgent[]>([]);
  // Full config (incl. real system prompt) for agents being edited — fetched owner-only, cached.
  const [editCache, setEditCache] = useState<Record<string, HostedFullConfig>>({});

  const scroller = useRef<HTMLDivElement | null>(null);

  const loadBrain = () => {
    api
      .genesisBrain()
      .then(setBrain)
      .catch(() => setBrain(null));
  };
  const loadAgents = () => {
    api
      .hosted()
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    loadBrain();
    loadAgents();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, []);

  // Mirror the transcript to localStorage on every change so it survives unmount/reload. Empty →
  // remove the key so a cleared history stays cleared. Wrapped: storage can be full or disabled.
  useEffect(() => {
    try {
      if (messages.length) localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
      else localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      /* ignore quota / unavailable storage */
    }
  }, [messages]);

  const needsAgentKey = useMemo(
    () => Boolean(config.provider && KEYED_AGENT_PROVIDERS.has(config.provider)),
    [config.provider],
  );
  // Editing an existing agent = the proposed handle matches one the owner already has.
  const isEdit = useMemo(
    () => Boolean(config.handle && agents.some((a) => a.handle === config.handle)),
    [config.handle, agents],
  );

  // Which agent (if any) the knowledge panel attaches to: the one just created, else the edit target.
  const knowledgeTarget = useMemo(() => {
    if (created) return { web3Id: created.web3Id, title: created.name };
    const match = config.handle ? agents.find((a) => a.handle === config.handle) : undefined;
    return match ? { web3Id: match.web3Id, title: match.name } : null;
  }, [created, config.handle, agents]);

  // When the brain targets an existing agent, fetch its full config (owner-only) once so the next
  // turn's brief carries the REAL system prompt — the brain then preserves it verbatim on edit.
  useEffect(() => {
    const h = config.handle;
    if (!isEdit || !h || editCache[h]) return;
    api
      .hostedConfig(h)
      .then((r) => setEditCache((c) => ({ ...c, [h]: r.config })))
      .catch(() => {}); // non-fatal: edit still works, just without prompt-preservation
  }, [isEdit, config.handle, editCache]);

  async function turn(next: GenesisTurn[], depth = 0) {
    setSending(true);
    setError('');
    setAsk(null);
    setMultiPick([]);
    try {
      const r = await api.genesisChat(
        next,
        agents.map((a) => toBrief(a, editCache[a.handle])),
      );
      const assistant: GenesisTurn = { role: 'assistant', content: r.reply || '…' };
      let convo = [...next, assistant];
      setMessages(convo);
      setConfig((prev) => ({ ...prev, ...(r.config ?? {}) }));
      setAsk(r.ask ?? null);
      setDone(Boolean(r.done));

      // TEST action: run the owner's agent, feed the result back so the brain can summarise it.
      const action = r.action as GenesisAction | null | undefined;
      if (action?.type === 'test' && action.handle && depth < 2) {
        let resultText: string;
        try {
          const { output } = await api.askHosted(action.handle, action.question);
          resultText = formatTestOutput(output);
        } catch (err) {
          resultText = `error — ${err instanceof Error ? err.message : String(err)}`;
        }
        convo = [
          ...convo,
          { role: 'user', content: `[Test result for ${action.handle}]: ${resultText}` },
        ];
        setMessages(convo);
        await turn(convo, depth + 1);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages(next); // keep the user's turn even if the brain call failed
    } finally {
      setSending(false);
      requestAnimationFrame(() =>
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }),
      );
    }
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || sending) return;
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

  // Stage files during the interview; they're indexed into the agent's RAG on create. Text-like files
  // read as text here; PDF/Word are carried as base64 for the node to extract.
  async function attachFiles(files: FileList) {
    const accepted: { name: string; text?: string; dataBase64?: string }[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      if (KB_DOC_EXT.test(file.name)) {
        accepted.push({ name: file.name, dataBase64: await fileToBase64(file) });
      } else if (KB_TEXT_EXT.test(file.name)) {
        accepted.push({ name: file.name, text: await file.text() });
      } else {
        rejected.push(file.name);
      }
    }
    if (accepted.length) setPendingFiles((p) => [...p, ...accepted]);
    setKbNote(
      rejected.length
        ? `Attached ${accepted.length} file(s). Skipped ${rejected.join(', ')} — upload PDF, Word (.docx), Excel (.xlsx), or text files (.txt .md .csv …).`
        : `Attached ${accepted.length} file(s) — I'll add these to the agent's knowledge when you create it.`,
    );
  }
  function removePending(name: string) {
    setPendingFiles((p) => p.filter((f) => f.name !== name));
  }

  async function launch() {
    setLaunching(true);
    setError('');
    setCreatedWasEdit(isEdit); // capture before the post-launch agents refresh flips isEdit
    try {
      // On an edit, fall back to the agent's stored config for any field the brain didn't restate —
      // above all the system prompt AND the price — so an edit never silently blanks the original.
      const base = config.handle ? editCache[config.handle] : undefined;
      const price =
        config.priceUsd !== undefined
          ? Math.max(0, Math.round(config.priceUsd * 100))
          : (base?.price ?? 0);
      const agent = await api.hostedLaunch({
        handle: config.handle ?? '',
        name: config.name ?? base?.name ?? config.handle ?? 'Agent',
        description: config.description ?? base?.description ?? '',
        skillId: config.skillId ?? base?.skillId ?? 'ask',
        skillName: config.skillName ?? base?.skillName ?? 'Ask',
        skillDesc: config.skillDesc ?? base?.skillDesc ?? 'Answer a question',
        price,
        provider: config.provider ?? base?.provider ?? 'local',
        model: config.model ?? base?.model ?? 'qwen2.5:7b',
        apiKey: agentKey.trim() || undefined,
        system: config.system ?? base?.system,
        connectors: config.connectors ?? base?.connectors,
      });
      setCreated(agent);
      setAgentKey('');
      // Flush any files attached during the interview into the new agent's RAG knowledge base.
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
            /* skip a file that fails to index; keep going with the rest */
          }
        }
        setPendingFiles([]);
        setKbNote(
          ok
            ? `Indexed ${ok} document${ok === 1 ? '' : 's'} into ${agent.name}'s knowledge base.`
            : '',
        );
      }
      loadAgents(); // so a follow-up edit/test sees the new (or just-updated) agent
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }

  function reset() {
    setMessages([]);
    setConfig({});
    setAsk(null);
    setDone(false);
    setCreated(null);
    setAgentKey('');
    setError('');
    setPendingFiles([]);
    setKbNote('');
  }

  // Delete the saved transcript and start a fresh chat. reset() empties `messages`, which the persist
  // effect then flushes from localStorage — the explicit remove is a belt-and-braces guard.
  async function clearHistory() {
    if (
      messages.length &&
      !(await uiConfirm('Delete this chat history? This can’t be undone.', {
        title: 'Clear chat history',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    reset();
    try {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      /* ignore unavailable storage */
    }
  }

  const brainReady = Boolean(brain?.configured);

  return (
    <div className="genesis-chat">
      <div className="page-head stack">
        <h2 className="section-title">Genesis chat</h2>
        <p className="muted">
          Describe the agent you want in plain language — Genesis interviews you, then creates,
          edits, or tests it. Every agent created here shows up in <strong>Agents</strong> with
          Start / Stop / Test / Copy-endpoint, rides the billing cycle, and gets x402 pricing +
          ERC-8004 identity automatically.
        </p>
        {messages.length > 0 && (
          <button
            type="button"
            className="btn"
            style={{ alignSelf: 'flex-start', fontSize: 12 }}
            onClick={clearHistory}
            title="Delete the saved chat transcript and start fresh"
          >
            Clear chat history
          </button>
        )}
      </div>

      {isAdmin && <BrainSettings brain={brain} onSaved={loadBrain} />}

      {!brainReady ? (
        <div className="card">
          <p className="muted">
            Genesis chat isn’t switched on yet. An admin (<code>sanjay@web3.0</code>) needs to
            choose the brain that powers it{isAdmin ? ' — use the panel above.' : '.'}
          </p>
        </div>
      ) : (
        <div className="gchat-grid">
          <div className="card gchat-thread">
            <div className="gchat-scroll" ref={scroller}>
              {messages.length === 0 && (
                <div className="gchat-empty muted">
                  <p>
                    Hi — I’m Genesis. I can create, edit, test, or answer questions about your
                    agents.
                  </p>
                  <div className="chip-pick">
                    {(agents.length > 0
                      ? [
                          'Create a new agent',
                          `Edit my ${agents[0]?.name ?? agents[0]?.handle} agent`,
                          `Test ${agents[0]?.handle}`,
                          'What agents do I have?',
                        ]
                      : [
                          'A support bot for my online store',
                          'An agent that answers FAQs about my business',
                          'A paid research assistant',
                        ]
                    ).map((s) => (
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
              {sending && (
                <div className="gchat-msg gchat-bot">
                  <div className="gchat-bubble gchat-typing" aria-label="Genesis is thinking">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
            </div>

            {ask?.options?.length ? (
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
                  <button type="button" className="btn act btn-sm" onClick={submitMulti}>
                    Continue
                  </button>
                )}
              </div>
            ) : null}

            {pendingFiles.length > 0 && (
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
            <form
              className="gchat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <label className="gchat-attach" title="Attach files for the agent's knowledge (RAG)">
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
                disabled={sending}
                onChange={(e) => setInput(e.target.value)}
              />
              <button type="submit" className="btn act" disabled={sending || !input.trim()}>
                Send
              </button>
            </form>
            {kbNote && <p className="hint ok">{kbNote}</p>}
            {error && <p className="hint err">{error}</p>}
          </div>

          <div className="card gchat-config">
            <h3 className="field-lbl">Agent so far</h3>
            <ConfigView config={config} />
            {created ? (
              <div className="gchat-created">
                <p className="hint ok">
                  {createdWasEdit ? 'Saved' : 'Launched'} {created.web3Id} — live on the node.
                </p>
                <label className="field-lbl" htmlFor="gc-endpoint">
                  Public endpoint
                </label>
                <div className="gchat-endpoint">
                  <code id="gc-endpoint">{endpointFor(created)}</code>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(endpointFor(created));
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? 'Copied' : 'Copy endpoint'}
                  </button>
                </div>
                <button type="button" className="btn act" onClick={reset}>
                  Create another
                </button>
              </div>
            ) : done ? (
              <div className="gchat-launch">
                {needsAgentKey && (
                  <div className="field">
                    <label className="field-lbl" htmlFor="gc-key">
                      {config.provider} API key (stored on the node, never shown again)
                    </label>
                    <input
                      id="gc-key"
                      type="password"
                      autoComplete="off"
                      placeholder="sk-…"
                      value={agentKey}
                      onChange={(e) => setAgentKey(e.target.value)}
                    />
                  </div>
                )}
                <button
                  type="button"
                  className="btn act"
                  disabled={launching || !config.handle || (needsAgentKey && !agentKey.trim())}
                  onClick={launch}
                >
                  {launching
                    ? isEdit
                      ? 'Saving…'
                      : 'Creating…'
                    : `${isEdit ? 'Save' : 'Create'} ${config.name ?? config.handle}`}
                </button>
              </div>
            ) : (
              <p className="muted gchat-tip">
                Keep chatting — when the agent is fully specified, a <strong>Create / Save</strong>{' '}
                button appears here. You can also ask me to test or answer questions about your
                agents.
              </p>
            )}
            {knowledgeTarget && (
              <KnowledgePanel key={knowledgeTarget.web3Id} {...knowledgeTarget} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The accumulated launch config, rendered as a compact key/value list. */
function ConfigView({ config }: { config: GenesisConfig }) {
  const rows: [string, string | undefined][] = [
    ['Handle', config.handle],
    ['Name', config.name],
    ['What it does', config.description],
    ['Skill', config.skillName],
    [
      'Brain',
      config.provider ? `${config.provider}${config.model ? ` · ${config.model}` : ''}` : undefined,
    ],
    [
      'Price',
      config.priceUsd === undefined
        ? undefined
        : config.priceUsd > 0
          ? `$${config.priceUsd.toFixed(2)} / call`
          : 'Free',
    ],
    ['Connectors', config.connectors?.length ? config.connectors.join(', ') : undefined],
  ];
  const filled = rows.filter(([, v]) => v);
  if (filled.length === 0) return <p className="muted gchat-tip">Nothing yet — start chatting.</p>;
  return (
    <dl className="kv-list">
      {filled.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Admin-only panel: pick which LLM powers Genesis chat. The key is stored server-side, never read back. */
function BrainSettings({ brain, onSaved }: { brain: GenesisBrain | null; onSaved: () => void }) {
  const [provider, setProvider] = useState(brain?.provider || 'local');
  const [model, setModel] = useState(brain?.model || 'qwen2.5:7b');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(brain?.baseUrl || '');
  const [connectors, setConnectors] = useState<string[]>(brain?.connectors ?? []);
  const [available, setAvailable] = useState<CustomConnector[]>([]);
  const [admin, setAdmin] = useState(() => localStorage.getItem(ADMIN_KEY) ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const preset = BRAINS.find((b) => b.id === provider);

  // The admin's own connectors (with real endpoints) the Genesis assistant can call mid-interview.
  useEffect(() => {
    api
      .connectors()
      .then((r) => setAvailable(r.connectors))
      .catch(() => setAvailable([]));
  }, []);

  const toggle = (name: string) =>
    setConnectors((c) => (c.includes(name) ? c.filter((x) => x !== name) : [...c, name]));

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      localStorage.setItem(ADMIN_KEY, admin);
      await api.setGenesisBrain(
        {
          provider,
          model,
          apiKey: apiKey || undefined,
          baseUrl: baseUrl || undefined,
          connectors,
        },
        admin || undefined,
      );
      setApiKey('');
      setMsg({ kind: 'ok', text: 'Genesis brain saved.' });
      onSaved();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="card gchat-admin" open={!brain?.configured}>
      <summary className="field-lbl">
        Admin · Genesis brain{' '}
        <span className="muted">
          {brain?.configured ? `(${brain.provider} · ${brain.model})` : '(not set)'}
        </span>
      </summary>
      <p className="hint">
        Choose the LLM that powers Genesis chat for every agent owner. The API key is stored on the
        node and never returned to any browser. Only <code>sanjay@web3.0</code> can change this.
      </p>
      <div className="form-grid">
        <div className="field">
          <label className="field-lbl" htmlFor="gb-provider">
            Provider
          </label>
          <select
            id="gb-provider"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              const p = BRAINS.find((b) => b.id === e.target.value);
              if (p) setModel(p.model);
            }}
          >
            {BRAINS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-lbl" htmlFor="gb-model">
            Model
          </label>
          <input id="gb-model" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        {preset?.needsKey && (
          <div className="field wide">
            <label className="field-lbl" htmlFor="gb-key">
              API key {brain?.hasKey ? '(leave blank to keep current)' : ''}
            </label>
            <input
              id="gb-key"
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        )}
        <div className="field wide">
          <label className="field-lbl" htmlFor="gb-baseurl">
            Base URL <span className="muted">(optional — override the provider endpoint)</span>
          </label>
          <input
            id="gb-baseurl"
            autoComplete="off"
            placeholder="e.g. http://127.0.0.1:11434/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <div className="field wide">
          <div className="field-lbl">
            Assistant connectors{' '}
            <span className="muted">
              — tools the Genesis chat itself may call mid-interview (e.g. a web-search connector so
              it can research “an agent like company X uses” and design one). Not the created
              agent’s connectors.
            </span>
          </div>
          {available.length === 0 ? (
            <p className="hint">
              No connectors yet. Add one in <strong>Connectors</strong> (e.g. a search API with an
              endpoint + key) and it’ll appear here.
            </p>
          ) : (
            <div className="chip-pick">
              {available.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={`chip-toggle ${connectors.includes(c.name) ? 'on' : ''}`}
                  onClick={() => toggle(c.name)}
                >
                  {connectors.includes(c.name) ? '✓ ' : ''}
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="field wide">
          <label className="field-lbl" htmlFor="gb-admin">
            Admin token
          </label>
          <input
            id="gb-admin"
            type="password"
            autoComplete="off"
            placeholder="WEB3_ADMIN_TOKEN"
            value={admin}
            onChange={(e) => setAdmin(e.target.value)}
          />
        </div>
      </div>
      <div className="gen-actions">
        <button type="button" className="btn act" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save brain'}
        </button>
        {msg && <span className={`hint ${msg.kind === 'ok' ? 'ok' : 'err'}`}>{msg.text}</span>}
      </div>
    </details>
  );
}
