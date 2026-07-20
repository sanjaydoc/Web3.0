import { useCallback, useEffect, useState } from 'react';
import {
  type ConsensusInfo,
  type CustomConnector,
  type SettlementInfo,
  type TelegramStatus,
  api,
} from './api.js';

interface Rail {
  name: string;
  kind: string;
  on: boolean;
  detail: string;
  view?: string;
}

interface Builtin {
  name: string;
  note: string;
  supported?: boolean; // true = usable now via an existing mechanism; else catalogue/available
}

/** 30+ built-in integrations, grouped by category. "supported" ones work today via the LLM
 * adapter, webhook dApps, or the live rails; the rest are catalogue entries you can wire with a
 * custom connector / webhook. */
const CATALOGUE: { category: string; items: Builtin[] }[] = [
  {
    category: 'Messaging & channels',
    items: [
      { name: 'Telegram', note: 'Human front door (built-in)', supported: true },
      { name: 'Slack', note: 'Team channel bot' },
      { name: 'Discord', note: 'Community bot' },
      { name: 'WhatsApp', note: 'Cloud API messaging' },
      { name: 'Email (SMTP/IMAP)', note: 'Inbox agent' },
      { name: 'SMS (Twilio)', note: 'Text messaging' },
      { name: 'Microsoft Teams', note: 'Enterprise chat' },
    ],
  },
  {
    category: 'Model providers (agent brains)',
    items: [
      { name: 'OpenAI', note: 'GPT models (OpenAI-compatible)', supported: true },
      { name: 'Anthropic Claude', note: 'Claude models', supported: true },
      { name: 'Google Gemini', note: 'Gemini models', supported: true },
      { name: 'Mistral', note: 'Mistral / Mixtral', supported: true },
      { name: 'Groq', note: 'Fast inference (OpenAI-compatible)', supported: true },
      { name: 'OpenRouter', note: 'Any model, one API', supported: true },
      { name: 'Ollama', note: 'Local models, no key', supported: true },
      { name: 'Cohere', note: 'Command models' },
      { name: 'Together AI', note: 'Open models hosted' },
      { name: 'Perplexity', note: 'Answer engine' },
    ],
  },
  {
    category: 'Data & storage',
    items: [
      { name: 'HTTP / REST webhook', note: 'Any endpoint (built-in dApp rail)', supported: true },
      { name: 'PostgreSQL', note: 'SQL database' },
      { name: 'MongoDB', note: 'Document database' },
      { name: 'Redis', note: 'Cache / queue' },
      { name: 'Amazon S3', note: 'Object storage' },
      { name: 'Google Sheets', note: 'Spreadsheets' },
      { name: 'Notion', note: 'Docs & databases' },
      { name: 'Airtable', note: 'Structured records' },
    ],
  },
  {
    category: 'Developer tools',
    items: [
      { name: 'GitHub', note: 'Repos, issues, PRs' },
      { name: 'GitLab', note: 'Repos & CI' },
      { name: 'Jira', note: 'Issue tracking' },
      { name: 'Linear', note: 'Product issues' },
    ],
  },
  {
    category: 'Search & web',
    items: [
      { name: 'Brave Search', note: 'Web search API' },
      { name: 'Tavily', note: 'Search for agents' },
      { name: 'SerpAPI', note: 'Search results' },
    ],
  },
  {
    category: 'Payments & finance',
    items: [
      { name: 'x402', note: 'Agentic payments (settlement)', supported: true },
      { name: 'Stripe', note: 'Card payments' },
      { name: 'Coinbase', note: 'Crypto on/off-ramp' },
    ],
  },
  {
    category: 'Automation',
    items: [
      { name: 'Zapier', note: '7000+ app automations' },
      { name: 'Make', note: 'Visual workflows' },
      { name: 'n8n', note: 'Self-hosted automation' },
    ],
  },
];

const total = CATALOGUE.reduce((n, g) => n + g.items.length, 0);

/** Flat list of built-in connector names, for pickers elsewhere (e.g. Genesis). */
export const BUILTIN_CONNECTORS: string[] = CATALOGUE.flatMap((g) => g.items.map((i) => i.name));

export function Connectors({ go }: { go?: (view: string) => void }) {
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [settle, setSettle] = useState<SettlementInfo | null>(null);
  const [cons, setCons] = useState<ConsensusInfo | null>(null);
  const [custom, setCustom] = useState<CustomConnector[]>([]);

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [description, setDescription] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCustom = useCallback(() => {
    api
      .connectors()
      .then((r) => setCustom(r.connectors))
      .catch(() => setCustom([]));
  }, []);

  useEffect(() => {
    const load = () => {
      api
        .telegram()
        .then(setTg)
        .catch(() => undefined);
      api
        .settlement()
        .then(setSettle)
        .catch(() => undefined);
      api
        .consensus()
        .then(setCons)
        .catch(() => undefined);
      loadCustom();
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [loadCustom]);

  async function addConnector() {
    setBusy(true);
    setMsg(null);
    try {
      const c = await api.createConnector({
        id: id.trim(),
        name: name.trim(),
        category: category.trim() || undefined,
        endpoint: endpoint.trim() || undefined,
        description: description.trim() || undefined,
      });
      setMsg({ kind: 'ok', text: `Connector "${c.name}" added.` });
      setId('');
      setName('');
      setCategory('');
      setEndpoint('');
      setDescription('');
      loadCustom();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const rails: Rail[] = [
    {
      name: 'Telegram',
      kind: 'Human front door',
      on: Boolean(tg?.running),
      detail: tg
        ? tg.running
          ? `live${tg.botUsername ? ` as @${tg.botUsername}` : ''}`
          : tg.tokenSet
            ? 'configured, stopped'
            : 'not configured'
        : '—',
      view: 'telegram',
    },
    {
      name: 'Settlement',
      kind: 'Payment rail',
      on: Boolean(settle),
      detail: settle ? `${settle.mode} · ${settle.network}` : '—',
    },
    {
      name: 'Distributed L1',
      kind: 'Consensus',
      on: Boolean(cons?.enabled),
      detail: cons
        ? cons.enabled
          ? `PoA · height ${cons.height} · ${cons.authorities.length} authorities`
          : 'solo node (off)'
        : '—',
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Connectors</h1>
        <span className="muted">
          {total}+ built-in integrations · {custom.length} custom — all managed here
        </span>
      </div>

      <div className="section-title">Live rails</div>
      <div className="grid-2">
        {rails.map((c) => (
          <button
            type="button"
            className="card connector"
            key={c.name}
            onClick={c.view && go ? () => go(c.view!) : undefined}
            disabled={!c.view}
          >
            <div
              className="section-title"
              style={{ display: 'flex', justifyContent: 'space-between' }}
            >
              <span>{c.name}</span>
              <span className={`chip ${c.on ? 'allow' : 'deny'}`}>{c.on ? 'active' : 'idle'}</span>
            </div>
            <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              {c.kind}
            </div>
            <div style={{ marginTop: 6 }}>{c.detail}</div>
            {c.view && go && <div className="conn-cta">Configure →</div>}
          </button>
        ))}
      </div>

      <div className="card" style={{ margin: '18px 0' }}>
        <div className="section-title">Add a custom connector</div>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Register any integration not in the catalogue — point it at a webhook or API endpoint.
        </p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="c-id">Connector id</label>
            <input
              id="c-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="my-crm"
            />
            <span className="hint">lowercase letters, digits, hyphens</span>
          </div>
          <div className="field">
            <label htmlFor="c-name">Name</label>
            <input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My CRM"
            />
          </div>
          <div className="field">
            <label htmlFor="c-cat">Category</label>
            <input
              id="c-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Custom"
            />
          </div>
          <div className="field">
            <label htmlFor="c-endpoint">Endpoint (optional)</label>
            <input
              id="c-endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://api.example.com"
            />
          </div>
          <div className="field wide">
            <label htmlFor="c-desc">Description</label>
            <input
              id="c-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this connector does"
            />
          </div>
        </div>
        <div className="gen-actions">
          <button
            type="button"
            className="btn act"
            disabled={busy || !id.trim() || !name.trim()}
            onClick={addConnector}
          >
            {busy ? 'Adding…' : 'Add connector'}
          </button>
        </div>
        {msg && (
          <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
        )}
      </div>

      {custom.length > 0 && (
        <>
          <div className="section-title">Custom connectors</div>
          <div className="grid-2" style={{ marginBottom: 18 }}>
            {custom.map((c) => (
              <div className="card" key={c.id}>
                <div
                  className="section-title"
                  style={{ display: 'flex', justifyContent: 'space-between' }}
                >
                  <span>{c.name}</span>
                  <span className="chip allow">custom</span>
                </div>
                <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  {c.category}
                </div>
                {c.description && <div style={{ marginTop: 6 }}>{c.description}</div>}
                {c.endpoint && <div className="mono-hash">{c.endpoint}</div>}
                <div className="hint">added by {c.createdBy}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {CATALOGUE.map((group) => (
        <div key={group.category}>
          <div className="section-title">{group.category}</div>
          <div className="conn-grid">
            {group.items.map((it) => (
              <div className="card conn-tile" key={it.name}>
                <div className="conn-tile-head">
                  <strong>{it.name}</strong>
                  <span className={`chip ${it.supported ? 'allow' : ''}`}>
                    {it.supported ? 'supported' : 'available'}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  {it.note}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
