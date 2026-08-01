import { useCallback, useEffect, useMemo, useState } from 'react';
import { BUILTIN_CONNECTORS } from './Connectors.js';
import { uiConfirm } from './dialog.js';
import {
  type CustomConnector,
  type HostedAgent,
  type LlmMarketOffer,
  NODE_URL,
  type SkillDef,
  api,
} from './api.js';
import { SKILL_TEMPLATES, type SkillTemplate, templateSystemFor } from './skill-templates.js';

const ADMIN_KEY = 'web3.adminToken';
// A model chosen from the Marketplace "Use this model" button is stashed here for Genesis to pick up.
const TUNNEL_PICK_KEY = 'web3.tunnelModel';

// Provider → a sensible default model to prefill when the provider changes.
const PROVIDERS: { id: string; label: string; model: string; needsKey: boolean }[] = [
  { id: 'local', label: 'Local (Ollama)', model: 'qwen2.5:7b', needsKey: false },
  { id: 'tunnel', label: 'Hosted model (network tunnel)', model: '', needsKey: false },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', needsKey: true },
  {
    id: 'openrouter',
    label: 'OpenRouter (many)',
    model: 'anthropic/claude-3.5-sonnet',
    needsKey: true,
  },
  { id: 'anthropic', label: 'Anthropic', model: 'claude-sonnet-5', needsKey: true },
  { id: 'groq', label: 'Groq', model: 'llama-3.3-70b-versatile', needsKey: true },
];

const py = (s: string) => JSON.stringify(s); // JSON strings are valid Python string literals

export function Genesis() {
  const [handle, setHandle] = useState('sage');
  const [name, setName] = useState('Sage');
  const [description, setDescription] = useState('Answers questions with an LLM.');
  const [skillId, setSkillId] = useState('ask');
  const [skillName, setSkillName] = useState('Ask');
  const [skillDesc, setSkillDesc] = useState('Answer a question');
  const [price, setPrice] = useState('3.00');
  const [priced, setPriced] = useState(true);
  const [createdBy, setCreatedBy] = useState('');
  const [copiedId, setCopiedId] = useState(''); // web3Id whose endpoint was just copied (button feedback)
  const [provider, setProvider] = useState('local');
  const [model, setModel] = useState('qwen2.5:7b');
  const [system, setSystem] = useState(
    'You are a concise, helpful expert agent on the Web3.0 network.',
  );
  // Once the owner hand-edits the system prompt we stop auto-filling it from a skill template.
  const [systemEdited, setSystemEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [admin, setAdmin] = useState(() => localStorage.getItem(ADMIN_KEY) ?? '');
  const [launching, setLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [hosted, setHosted] = useState<HostedAgent[]>([]);
  const [adminRequired, setAdminRequired] = useState(false);
  // Only admin's generated script embeds the authority's real address; operators get a placeholder.
  const [isAdmin, setIsAdmin] = useState(false);
  const [connectors, setConnectors] = useState<string[]>([]);
  const [customConns, setCustomConns] = useState<CustomConnector[]>([]);
  // Federated hosted models an agent can use as a 'tunnel' brain (from the network marketplace).
  const [tunnelModels, setTunnelModels] = useState<LlmMarketOffer[]>([]);

  const current = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  // Pick a skill template: fill id/name/description + the agent's system prompt in one click.
  // Your OWN registered skills (the node scopes /skills to you) that aren't one of the built-in
  // templates — so you can start an agent from a custom skill you defined, not just the shelf.
  const [mySkills, setMySkills] = useState<SkillDef[]>([]);
  useEffect(() => {
    const builtinIds = new Set(SKILL_TEMPLATES.map((t) => t.id));
    api
      .skills()
      .then((r) => setMySkills(r.skills.filter((s) => !builtinIds.has(s.id))))
      .catch(() => setMySkills([]));
  }, []);

  // Fill the skill fields from one of YOUR registered skills. Its system prompt (if you stashed one
  // when registering from a template) is applied by the skillId effect below.
  const pickSkill = (s: SkillDef) => {
    setSkillId(s.id);
    setSkillName(s.name);
    setSkillDesc(s.description);
    setSystemEdited(false);
  };

  const pickTemplate = (t: SkillTemplate) => {
    setSkillId(t.id);
    setSkillName(t.name);
    setSkillDesc(t.description);
    setSystem(t.system);
    setSystemEdited(false);
    // Auto-attach the connector this skill pairs with, so the skill and its data source line up in
    // one click. (Still needs wiring with a key in the Connectors tab to actually fetch live data.)
    if (t.connector) {
      const conn = t.connector;
      setConnectors((cur) => (cur.includes(conn) ? cur : [...cur, conn]));
    }
  };

  // Off-the-shelf loop: when the skill id matches a template (or one the owner registered from the
  // Skills section), pre-fill the system prompt — unless they've already hand-edited it.
  useEffect(() => {
    if (systemEdited) return;
    const s = templateSystemFor(skillId);
    if (s) setSystem(s);
  }, [skillId, systemEdited]);

  // Distinct model tags on offer across the network, with how many hosts serve each (the tunnel
  // auto-routes to the best host, so an agent only needs to pick the model tag).
  const tunnelChoices = useMemo(() => {
    const byTag = new Map<string, number>();
    for (const o of tunnelModels) byTag.set(o.model, (byTag.get(o.model) ?? 0) + 1);
    return [...byTag.entries()].map(([tag, hosts]) => ({ tag, hosts }));
  }, [tunnelModels]);

  // Load the federated model market whenever the tunnel brain is selected.
  useEffect(() => {
    if (provider !== 'tunnel') return;
    let live = true;
    api
      .llmMarket()
      .then((r) => {
        if (live) setTunnelModels(r.offers);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [provider]);

  // If the user arrived via Marketplace → "Use this model", preselect the tunnel brain + that model.
  useEffect(() => {
    const picked = localStorage.getItem(TUNNEL_PICK_KEY);
    if (picked) {
      localStorage.removeItem(TUNNEL_PICK_KEY);
      setProvider('tunnel');
      setModel(picked);
    }
  }, []);

  // The operator's OWN custom connectors (the node already scopes /connectors to the caller).
  const customNames = useMemo(() => customConns.map((c) => c.name), [customConns]);
  // The 3 most-recently-added custom connectors — surfaced as quick-pick pills at the top of the form.
  const recentConnectors = useMemo(
    () =>
      [...customConns]
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        .slice(0, 3)
        .map((c) => c.name),
    [customConns],
  );
  const toggleConnector = (nameStr: string) =>
    setConnectors((cur) =>
      cur.includes(nameStr) ? cur.filter((c) => c !== nameStr) : [...cur, nameStr],
    );

  const refreshHosted = useCallback(async () => {
    try {
      const res = await api.hosted();
      // Genesis manages agents (LLM brains) only — webhook dApps live in Developers / Hosted dApps.
      setHosted(res.agents.filter((a) => a.kind === 'llm'));
      setAdminRequired(res.adminRequired);
    } catch {
      /* node may be offline */
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then((m) => setIsAdmin(m.role === 'admin'))
      .catch(() => setIsAdmin(false));
  }, []);

  useEffect(() => {
    refreshHosted();
    const t = setInterval(refreshHosted, 5000);
    return () => clearInterval(t);
  }, [refreshHosted]);

  useEffect(() => {
    api
      .connectors()
      .then((r) => setCustomConns(r.connectors))
      .catch(() => setCustomConns([]));
  }, []);

  const rememberAdmin = (value: string) => {
    setAdmin(value);
    localStorage.setItem(ADMIN_KEY, value);
  };

  async function launch() {
    setLaunching(true);
    setLaunchMsg(null);
    try {
      // When priced, the skill becomes a pay-per-call x402 endpoint; when off, it's free (perTask 0).
      const minorUnits = priced
        ? Math.max(0, Math.round(Number.parseFloat(price || '0') * 100))
        : 0;
      const agent = await api.hostedLaunch(
        {
          handle,
          name,
          description,
          skillId,
          skillName,
          skillDesc,
          price: minorUnits,
          provider,
          model,
          apiKey: apiKey || undefined,
          system,
          createdBy: createdBy.trim() || undefined,
          connectors,
        },
        admin,
      );
      if (createdBy.trim()) localStorage.setItem('web3.creatorName', createdBy.trim());
      setLaunchMsg({ kind: 'ok', text: `Launched ${agent.web3Id} — live on the node.` });
      setApiKey('');
      refreshHosted();
    } catch (err) {
      setLaunchMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLaunching(false);
    }
  }

  async function stopHosted(h: string) {
    try {
      await api.hostedStop(h, admin);
      refreshHosted();
    } catch (err) {
      setLaunchMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function deleteHosted(h: string) {
    if (
      !(await uiConfirm(`Delete agent "${h}"? This can't be undone.`, {
        title: 'Delete agent',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await api.hostedDelete(h, admin);
      refreshHosted();
    } catch (err) {
      setLaunchMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  }

  const script = useMemo(() => {
    const minorUnits = priced ? Math.max(0, Math.round(Number.parseFloat(price || '0') * 100)) : 0;
    return `"""Web3.0 agent generated by Genesis. Bring your own key — it stays on your machine.

Run it:
  ${current.needsKey ? '1. Put your provider key in .env:  LLM_API_KEY=your-key\\n  ' : ''}${current.needsKey ? '2' : '1'}. python ${handle}_agent.py

The agent registers on your node, connects, and ${priced ? `starts earning ${price} USDC per task (a pay-per-call x402 endpoint)` : 'serves its skill for free'}.
"""

import time
from web3_sdk import Agent, LLM, LLMError, load_env

load_env()  # reads LLM_API_KEY / LLM_* from your .env (never sent to the network)

agent = Agent(
    ${py(handle)},
    name=${py(name)},
    description=${py(description)},
    base_url=${py(isAdmin ? NODE_URL : 'https://<your-node-address>')},
    skills=[{"id": ${py(skillId)}, "name": ${py(skillName)}, "description": ${py(skillDesc)}, "tags": []}],
    pricing={"perTask": ${minorUnits}, "currency": "USDC"},
)

# The brain — your chosen provider and model. The key comes from LLM_API_KEY in .env.
brain = LLM.provider(${py(provider)}, model=${py(model)}, system=${py(system)})

agent.register()

def on_task(a, message):
    body = message["body"]
    payload = body.get("input", {})
    prompt = payload.get("prompt") or payload.get("question") or str(payload)
    try:
        answer = brain.chat(prompt)
    except LLMError as exc:
        a.reply_result(message["from"], body["taskId"], {"error": str(exc)}, state="failed")
        return
    a.reply_result(message["from"], body["taskId"], {"answer": answer})

agent.on_task(on_task)
agent.connect()
print(f"{agent.web3_id} is live on Web3.0 (brain: {brain.provider_name}/{brain.model}). Ctrl+C to stop.")
while True:
    time.sleep(1)
`;
  }, [
    handle,
    name,
    description,
    skillId,
    skillName,
    skillDesc,
    price,
    priced,
    provider,
    model,
    system,
    current,
    isAdmin,
  ]);

  function onProviderChange(id: string) {
    setProvider(id);
    const preset = PROVIDERS.find((p) => p.id === id);
    if (preset) setModel(preset.model);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Genesis</h1>
        <span className="muted">spin up an agent — pick a brain, keep your own key</span>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Configure your agent</div>

        {/* Quick-pick: your 3 most-recently-added connectors, so it's one click to attach a connector
            you just created — no scrolling. You can still pick more (or none) in the section below. */}
        {recentConnectors.length > 0 && (
          <div style={{ margin: '0 0 14px' }}>
            <div className="hint" style={{ marginBottom: 6 }}>
              Recent connectors — tap to attach:
            </div>
            <div className="chip-pick">
              {recentConnectors.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`chip-toggle ${connectors.includes(c) ? 'on' : ''}`}
                  onClick={() => toggleConnector(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="form-grid">
          <div className="field">
            <label htmlFor="g-handle">Web3.0 ID</label>
            <input id="g-handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
            <span className="hint">{handle || '…'}@web3.0</span>
          </div>
          <div className="field">
            <label htmlFor="g-name">Display name</label>
            <input id="g-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field wide">
            <label htmlFor="g-desc">Description</label>
            <input
              id="g-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="g-provider">LLM provider (brain)</label>
            <select
              id="g-provider"
              value={provider}
              onChange={(e) => onProviderChange(e.target.value)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="hint">
              {current.needsKey
                ? 'needs your API key in .env (LLM_API_KEY)'
                : 'runs locally, no key'}
            </span>
          </div>
          {provider === 'tunnel' ? (
            <div className="field">
              <label htmlFor="g-model-tunnel">Hosted model</label>
              <select id="g-model-tunnel" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">— pick a hosted model —</option>
                {tunnelChoices.map((c) => (
                  <option key={c.tag} value={c.tag}>
                    {c.tag} ({c.hosts} host{c.hosts === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
              <span className="hint">
                {tunnelChoices.length === 0
                  ? 'no hosted models on the network yet — an operator must publish one'
                  : 'runs on a network operator’s machine, billed per token from your wallet'}
              </span>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="g-model">Model</label>
              <input id="g-model" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
          )}

          {current.needsKey && (
            <div className="field wide">
              <label htmlFor="g-key">{current.label} API key (for launching on the node)</label>
              <input
                id="g-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="stored server-side, only used to run this agent"
              />
              <span className="hint">
                Only needed for the “Launch on node” button. The downloadable script reads its key
                from your own <code>.env</code> instead.
              </span>
            </div>
          )}

          {mySkills.length > 0 && (
            <div className="field wide">
              <span className="field-lbl">Your custom skills</span>
              <div className="chip-pick">
                {mySkills.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={`chip-toggle ${skillId === s.id ? 'on' : ''}`}
                    title={s.description}
                    onClick={() => pickSkill(s)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <span className="hint">skills you registered in the Skills tab</span>
            </div>
          )}
          <div className="field wide">
            <span className="field-lbl">Start from a skill template</span>
            <div className="chip-pick">
              {SKILL_TEMPLATES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={`chip-toggle ${skillId === t.id ? 'on' : ''}`}
                  title={t.description}
                  onClick={() => pickTemplate(t)}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <span className="hint">
              or just type a skill id/name below — a custom skill works too
            </span>
          </div>

          <div className="field">
            <label htmlFor="g-skill-id">Skill id</label>
            <input id="g-skill-id" value={skillId} onChange={(e) => setSkillId(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="g-priced">Monetize this skill (x402)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label className="switch" htmlFor="g-priced">
                <input
                  id="g-priced"
                  type="checkbox"
                  checked={priced}
                  onChange={(e) => setPriced(e.target.checked)}
                />
                <span className="slider" />
              </label>
              {priced ? (
                <input
                  id="g-price"
                  aria-label="Price per task"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  style={{ maxWidth: 120 }}
                />
              ) : (
                <span className="muted">Free — no payment required</span>
              )}
              {priced && <span className="muted">USDC per call</span>}
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 'var(--fs-sm)' }}>
              {priced
                ? 'Priced skills are automatically a pay-per-call x402 API — callers pay this rate and it builds the agent’s ERC-8004 reputation.'
                : 'Free skills serve without payment (perTask 0).'}
            </div>
          </div>
          <div className="field">
            <label htmlFor="g-creator">Created by (your name / team)</label>
            <input
              id="g-creator"
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              placeholder="e.g. Dr. Sanjay Anbu"
            />
          </div>
          <div className="field">
            <label htmlFor="g-skill-name">Skill name</label>
            <input
              id="g-skill-name"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="g-skill-desc">Skill description</label>
            <input
              id="g-skill-desc"
              value={skillDesc}
              onChange={(e) => setSkillDesc(e.target.value)}
            />
          </div>
          <div className="field wide">
            <label htmlFor="g-system">System prompt (the agent's persona)</label>
            <textarea
              id="g-system"
              value={system}
              onChange={(e) => {
                setSystem(e.target.value);
                setSystemEdited(true);
              }}
            />
          </div>
          {/* Your own custom connectors first (they carry your keys), then the built-in catalogue. */}
          {customNames.length > 0 && (
            <div className="field wide">
              <span className="field-lbl">Custom Connectors</span>
              <div className="chip-pick">
                {customNames.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`chip-toggle ${connectors.includes(c) ? 'on' : ''}`}
                    onClick={() => toggleConnector(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <span className="hint">your own connectors — created in the Connectors tab</span>
            </div>
          )}
          <div className="field wide">
            <span className="field-lbl">Connectors this agent uses</span>
            <div className="chip-pick">
              {BUILTIN_CONNECTORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`chip-toggle ${connectors.includes(c) ? 'on' : ''}`}
                  onClick={() => toggleConnector(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <span className="hint">
              {connectors.length} selected — click to add/remove. Add more in the Connectors tab.
            </span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Launch on the node (one click — no VPS)</div>
        <p className="muted" style={{ margin: '2px 0 12px' }}>
          Run this agent inside the node itself. It registers, hosts its LLM brain, and starts
          earning immediately — nothing to install, no separate process.
        </p>
        {adminRequired && (
          <div className="field wide">
            <label htmlFor="g-admin">Admin token</label>
            <input
              id="g-admin"
              type="password"
              value={admin}
              onChange={(e) => rememberAdmin(e.target.value)}
              placeholder="required to launch on this node"
            />
          </div>
        )}
        <div className="gen-actions">
          <button type="button" className="btn act" disabled={launching} onClick={launch}>
            {launching ? 'Launching…' : 'Launch on node'}
          </button>
        </div>
        {launchMsg && (
          <div className={`note ${launchMsg.kind === 'err' ? 'note-err' : 'note-ok'}`}>
            {launchMsg.text}
          </div>
        )}
        {hosted.length > 0 && (
          <ul className="kv-list" style={{ marginTop: 14 }}>
            {hosted.map((h) => (
              <li key={h.web3Id}>
                <span>
                  <code>{h.web3Id}</code> · {h.provider}/{h.model} ·{' '}
                  <span className={`chip ${h.running ? 'allow' : 'deny'}`}>
                    {h.running ? 'running' : 'stopped'}
                  </span>
                  {h.connectors && h.connectors.length > 0 && (
                    <span className="muted" style={{ marginLeft: 6, fontSize: 'var(--fs-sm)' }}>
                      · connectors: {h.connectors.join(', ')}
                    </span>
                  )}
                </span>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  {/* Copy the agent's callable endpoint so it drops straight into an app/workflow.
                      Priced agents → their x402 (pay-per-call) URL; free agents → the public /ask URL. */}
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title={
                      h.price > 0
                        ? "Copy this agent's paid (x402) endpoint"
                        : "Copy this agent's public endpoint — POST a question, get an answer"
                    }
                    onClick={() => {
                      const url =
                        h.price > 0
                          ? `${NODE_URL}/x402/call/${h.web3Id}/${h.skill}`
                          : `${NODE_URL}/agents/${h.web3Id}/ask`;
                      navigator.clipboard?.writeText(url);
                      setCopiedId(h.web3Id);
                      setTimeout(() => setCopiedId(''), 1500);
                    }}
                  >
                    {copiedId === h.web3Id
                      ? 'Copied'
                      : h.price > 0
                        ? 'Copy paid endpoint'
                        : 'Copy endpoint'}
                  </button>
                  {h.running && (
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={() => stopHosted(h.handle)}
                    >
                      Stop
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-delete"
                    onClick={() => deleteHosted(h.handle)}
                    title="Delete this agent"
                    aria-label={`Delete ${h.handle}`}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="section-title">Or download the script</div>
        <div className="gen-actions">
          <button type="button" className="btn btn-sm" onClick={copy}>
            Copy script
          </button>
          {copied && <span className="copied">Copied</span>}
        </div>
        <pre>
          <code>{script}</code>
        </pre>
        <div className="section-title" style={{ marginTop: 18 }}>
          Launch it
        </div>
        <ol className="steps">
          <li>
            Save the script as <code>{handle}_agent.py</code> in the repo folder.
          </li>
          {current.needsKey && (
            <li>
              Put your {current.label} key in <code>.env</code>: <code>LLM_API_KEY=your-key</code>
            </li>
          )}
          <li>
            Activate the venv and run it: <code>python {handle}_agent.py</code>
          </li>
          <li>Your agent registers, connects, and appears live in Agents & Live traffic.</li>
        </ol>
        <p className="hint" style={{ marginTop: 10 }}>
          Your provider key stays on your machine — it is never sent to the Web3.0 node or the
          network.
        </p>
      </div>
    </>
  );
}
