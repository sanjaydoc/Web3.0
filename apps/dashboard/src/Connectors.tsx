import { useCallback, useEffect, useState } from 'react';
import {
  type ConsensusInfo,
  type CustomConnector,
  type SettlementInfo,
  type TelegramStatus,
  type VaultSecret,
  api,
} from './api.js';
import { uiConfirm } from './dialog.js';

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

/**
 * One-click prefills for the custom-connector form — the tools an agent (or the Genesis assistant
 * itself) actually needs. Each fills a working endpoint that uses `{{query}}` (the node injects the
 * live question/text); the admin just drops in their key where a `YOUR_…` placeholder appears (it may
 * live in the URL, the headers, or the body). Two uses:
 *   • Attach the SEARCH/DATA ones (DuckDuckGo, Wikipedia, News, Weather…) to the Genesis brain so it
 *     can research a company and design a matching agent ("build me an agent like X uses").
 *   • Attach the ACTION ones (Gmail, Calendar, Slack, Telegram) to a CREATED agent so it can read a
 *     user's inbox/calendar or post messages.
 * Curated to 10 relevant integrations — no demo/placeholder connectors.
 */
interface ConnectorTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST';
  headers: string;
  body: string;
  needsKey: boolean;
}
const TEMPLATES: ConnectorTemplate[] = [
  // ── Search & web (research the brain uses to design agents) ──────────────────────────────────
  {
    id: 'duckduckgo-search',
    name: 'DuckDuckGo Search',
    category: 'Search & web',
    description: 'Free web search (Instant Answer API) — no API key.',
    endpoint: 'https://api.duckduckgo.com/?q={{query}}&format=json&no_html=1&skip_disambig=1',
    method: 'GET',
    headers: '',
    body: '',
    needsKey: false,
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    category: 'Search & web',
    description: 'Brave Web Search API — paste your subscription token.',
    endpoint: 'https://api.search.brave.com/res/v1/web/search?q={{query}}&count=5',
    method: 'GET',
    headers: 'Accept: application/json\nX-Subscription-Token: YOUR_BRAVE_API_KEY',
    body: '',
    needsKey: true,
  },
  {
    id: 'tavily-search',
    name: 'Tavily Search',
    category: 'Search & web',
    description: 'Tavily search built for agents — paste your API key.',
    endpoint: 'https://api.tavily.com/search',
    method: 'POST',
    headers: 'Authorization: Bearer YOUR_TAVILY_API_KEY\nContent-Type: application/json',
    body: '{"query": "{{query}}", "max_results": 5, "search_depth": "basic"}',
    needsKey: true,
  },
  {
    id: 'wikipedia-search',
    name: 'Wikipedia',
    category: 'Search & web',
    description: 'Free knowledge lookup (MediaWiki search API) — no API key.',
    endpoint:
      'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={{query}}&srlimit=5&format=json',
    method: 'GET',
    headers: '',
    body: '',
    needsKey: false,
  },
  // ── Data & knowledge ─────────────────────────────────────────────────────────────────────────
  {
    id: 'openweather',
    name: 'Weather (OpenWeatherMap)',
    category: 'Data & knowledge',
    description: 'Current weather by city — paste your OpenWeatherMap key (in the URL).',
    endpoint:
      'https://api.openweathermap.org/data/2.5/weather?q={{query}}&appid=YOUR_OPENWEATHER_API_KEY&units=metric',
    method: 'GET',
    headers: '',
    body: '',
    needsKey: true,
  },
  {
    id: 'newsapi',
    name: 'News (NewsAPI)',
    category: 'Data & knowledge',
    description: 'Latest news headlines matching a topic — paste your NewsAPI key.',
    endpoint: 'https://newsapi.org/v2/everything?q={{query}}&pageSize=5&sortBy=publishedAt',
    method: 'GET',
    headers: 'X-Api-Key: YOUR_NEWSAPI_KEY',
    body: '',
    needsKey: true,
  },
  // ── Productivity (actions a created agent performs) ──────────────────────────────────────────
  {
    id: 'gmail-search',
    name: 'Gmail (search inbox)',
    category: 'Productivity',
    description:
      'Search the user’s Gmail — paste a Google OAuth token (gmail.readonly scope) as the Bearer.',
    endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q={{query}}&maxResults=5',
    method: 'GET',
    headers: 'Authorization: Bearer YOUR_GMAIL_OAUTH_TOKEN',
    body: '',
    needsKey: true,
  },
  {
    id: 'gcal-events',
    name: 'Google Calendar (events)',
    category: 'Productivity',
    description: 'List calendar events matching a term — paste a Google OAuth token as the Bearer.',
    endpoint:
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?q={{query}}&maxResults=5&singleEvents=true&orderBy=startTime',
    method: 'GET',
    headers: 'Authorization: Bearer YOUR_GOOGLE_OAUTH_TOKEN',
    body: '',
    needsKey: true,
  },
  // ── Messaging (an agent posts/notifies) ──────────────────────────────────────────────────────
  {
    id: 'slack-post',
    name: 'Slack (post message)',
    category: 'Messaging',
    description: 'Post to a Slack channel via an Incoming Webhook — paste your webhook URL below.',
    endpoint: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK',
    method: 'POST',
    headers: 'Content-Type: application/json',
    body: '{"text": "{{query}}"}',
    needsKey: true,
  },
  {
    id: 'telegram-send',
    name: 'Telegram (send message)',
    category: 'Messaging',
    description:
      'Send a Telegram message — put your bot token in the URL and a chat id in the body.',
    endpoint: 'https://api.telegram.org/botYOUR_BOT_TOKEN/sendMessage',
    method: 'POST',
    headers: 'Content-Type: application/json',
    body: '{"chat_id": "YOUR_CHAT_ID", "text": "{{query}}"}',
    needsKey: true,
  },
];

export function Connectors({ go }: { go?: (view: string) => void }) {
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [settle, setSettle] = useState<SettlementInfo | null>(null);
  const [cons, setCons] = useState<ConsensusInfo | null>(null);
  const [custom, setCustom] = useState<CustomConnector[]>([]);

  // Office tools · Email credential (vault). Lets an agent's send_email tool send from this mailbox.
  const [emailCred, setEmailCred] = useState<VaultSecret | null>(null);
  const [emailProviders, setEmailProviders] = useState<string[]>([]);
  const [emProvider, setEmProvider] = useState('gmail');
  const [emUser, setEmUser] = useState('');
  const [emPass, setEmPass] = useState('');
  const [emFrom, setEmFrom] = useState('');
  const [emMsg, setEmMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [emBusy, setEmBusy] = useState(false);

  // Office tools · Google (OAuth) — one connect grants Gmail + Calendar. Preferred over app passwords,
  // and the ONLY way to use Google Calendar. Populated from the vault ('google' credential).
  const [googleCred, setGoogleCred] = useState<VaultSecret | null>(null);
  const [gMsg, setGMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Office tools · Calendar credential (CalDAV app password) — powers create_event / list_events.
  const [calCred, setCalCred] = useState<VaultSecret | null>(null);
  const [caldavProviders, setCaldavProviders] = useState<string[]>([]);
  const [calProvider, setCalProvider] = useState('icloud');
  const [calUser, setCalUser] = useState('');
  const [calPass, setCalPass] = useState('');
  const [calServer, setCalServer] = useState('');
  const [calMsg, setCalMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [calBusy, setCalBusy] = useState(false);

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [headersText, setHeadersText] = useState('');
  const [reqBody, setReqBody] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill the whole create form from a one-click template (the admin edits the key, then saves).
  function applyTemplate(t: ConnectorTemplate) {
    setId(t.id);
    setName(t.name);
    setCategory(t.category);
    setDescription(t.description);
    setEndpoint(t.endpoint);
    setMethod(t.method);
    setHeadersText(t.headers);
    setReqBody(t.body);
    setMsg(
      t.needsKey
        ? { kind: 'ok', text: `Loaded ${t.name} — replace YOUR_…_KEY in Headers, then Add.` }
        : { kind: 'ok', text: `Loaded ${t.name} — no key needed, just Add.` },
    );
  }

  // Parse the headers textarea ("Key: Value" per line) into the {key,value}[] the node expects.
  function parseHeaders(text: string): { key: string; value: string }[] {
    return text
      .split('\n')
      .map((line) => {
        const i = line.indexOf(':');
        if (i < 0) return null;
        const key = line.slice(0, i).trim();
        const value = line.slice(i + 1).trim();
        return key ? { key, value } : null;
      })
      .filter((h): h is { key: string; value: string } => h !== null);
  }

  const loadCustom = useCallback(() => {
    api
      .connectors()
      .then((r) => setCustom(r.connectors))
      .catch(() => setCustom([]));
  }, []);

  const loadVault = useCallback(() => {
    api
      .vault()
      .then((r) => {
        // Only offer preset providers in the dropdown; 'custom' SMTP needs host fields (API-only for now).
        setEmailProviders(r.emailProviders.filter((p) => p !== 'custom'));
        setEmailCred(r.secrets.find((s) => s.id === 'email') ?? null);
        setCaldavProviders(r.caldavProviders);
        setCalCred(r.secrets.find((s) => s.id === 'calendar') ?? null);
        setGoogleCred(r.secrets.find((s) => s.id === 'google') ?? null);
      })
      .catch(() => undefined);
  }, []);

  async function connectGoogle() {
    setGMsg(null);
    try {
      const { url } = await api.oauthStart('google');
      // Open the consent flow in a popup; loadVault polls, so the connected state appears on return.
      window.open(url, 'web4-oauth-google', 'width=520,height=680');
      setGMsg({ kind: 'ok', text: 'Opening Google sign-in… approve access, then return here.' });
    } catch (err) {
      setGMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function disconnectGoogle() {
    if (
      !(await uiConfirm('Disconnect Google? Agents will fall back to any app passwords you set.', {
        title: 'Disconnect Google',
        confirmLabel: 'Disconnect',
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteVaultSecret('google');
      setGMsg({ kind: 'ok', text: 'Google disconnected.' });
      loadVault();
    } catch (err) {
      setGMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  }

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
      loadVault();
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [loadCustom, loadVault]);

  async function saveEmail() {
    setEmBusy(true);
    setEmMsg(null);
    try {
      await api.saveEmailCredential({
        provider: emProvider,
        user: emUser.trim(),
        pass: emPass,
        fromName: emFrom.trim() || undefined,
      });
      setEmMsg({
        kind: 'ok',
        text: 'Email connected. Agents with the send_email tool can now send from this address.',
      });
      setEmPass('');
      loadVault();
    } catch (err) {
      setEmMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setEmBusy(false);
    }
  }

  async function removeEmail() {
    if (
      !(await uiConfirm('Disconnect email? Agents will no longer be able to send from it.', {
        title: 'Disconnect email',
        confirmLabel: 'Disconnect',
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteVaultSecret('email');
      setEmMsg({ kind: 'ok', text: 'Email disconnected.' });
      loadVault();
    } catch (err) {
      setEmMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function saveCalendar() {
    setCalBusy(true);
    setCalMsg(null);
    try {
      await api.saveCalendarCredential({
        provider: calProvider,
        user: calUser.trim(),
        pass: calPass,
        serverUrl: calProvider === 'custom' ? calServer.trim() || undefined : undefined,
      });
      setCalMsg({
        kind: 'ok',
        text: 'Calendar connected. Agents with create_event / list_events can now use it.',
      });
      setCalPass('');
      loadVault();
    } catch (err) {
      setCalMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setCalBusy(false);
    }
  }

  async function removeCalendar() {
    if (
      !(await uiConfirm('Disconnect calendar? Agents will no longer be able to use it.', {
        title: 'Disconnect calendar',
        confirmLabel: 'Disconnect',
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteVaultSecret('calendar');
      setCalMsg({ kind: 'ok', text: 'Calendar disconnected.' });
      loadVault();
    } catch (err) {
      setCalMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  }

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
        method,
        headers: parseHeaders(headersText),
        body: method === 'POST' ? reqBody.trim() || undefined : undefined,
      });
      setMsg({ kind: 'ok', text: `Connector "${c.name}" added.` });
      setId('');
      setName('');
      setCategory('');
      setEndpoint('');
      setDescription('');
      setMethod('GET');
      setHeadersText('');
      setReqBody('');
      loadCustom();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function removeConnector(c: CustomConnector) {
    if (
      !(await uiConfirm(`Delete connector "${c.name}"? This can’t be undone.`, {
        title: 'Delete connector',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteConnector(c.id);
      setMsg({ kind: 'ok', text: `Connector "${c.name}" deleted.` });
      loadCustom();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
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
        <div className="section-title">Office tools · Google (recommended)</div>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Connect your Google account once for <strong>Gmail + Calendar</strong> — no app password
          needed, and it's the only way to use Google Calendar. Agents prefer this over app
          passwords when it's connected.
        </p>
        {googleCred ? (
          <div
            className="note note-ok"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span>
              Connected: <strong>{googleCred.public.email ?? 'Google account'}</strong>
            </span>
            <button type="button" className="btn-delete" onClick={disconnectGoogle}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="gen-actions">
            <button type="button" className="btn act" onClick={connectGoogle}>
              Connect Google
            </button>
          </div>
        )}
        {gMsg && (
          <div className={`note ${gMsg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{gMsg.text}</div>
        )}
      </div>

      <div className="card" style={{ margin: '18px 0' }}>
        <div className="section-title">Office tools · Email (app password)</div>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Connect a mailbox so agents with the <code>send_email</code> / <code>read_email</code>
          tools can send and read mail on your behalf. Paste an <strong>app password</strong> (not
          your normal login password) — for Gmail, create one at myaccount.google.com → Security →
          App passwords. It's stored on your node and never shown again.
        </p>
        {emailCred && (
          <div
            className="note note-ok"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <span>
              Connected: <strong>{emailCred.public.user}</strong> ({emailCred.public.provider})
            </span>
            <button type="button" className="btn-delete" onClick={removeEmail}>
              Disconnect
            </button>
          </div>
        )}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="em-provider">Provider</label>
            <select
              id="em-provider"
              value={emProvider}
              onChange={(e) => setEmProvider(e.target.value)}
            >
              {(emailProviders.length
                ? emailProviders
                : ['gmail', 'outlook', 'office365', 'yahoo', 'zoho', 'icloud']
              ).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="em-user">Email address</label>
            <input
              id="em-user"
              value={emUser}
              onChange={(e) => setEmUser(e.target.value)}
              placeholder="you@gmail.com"
            />
          </div>
          <div className="field">
            <label htmlFor="em-pass">App password</label>
            <input
              id="em-pass"
              type="password"
              value={emPass}
              onChange={(e) => setEmPass(e.target.value)}
              placeholder="16-character app password"
            />
          </div>
          <div className="field">
            <label htmlFor="em-from">From name (optional)</label>
            <input
              id="em-from"
              value={emFrom}
              onChange={(e) => setEmFrom(e.target.value)}
              placeholder="Your name or company"
            />
          </div>
        </div>
        <div className="gen-actions">
          <button
            type="button"
            className="btn act"
            disabled={emBusy || !emUser.trim() || !emPass}
            onClick={saveEmail}
          >
            {emBusy ? 'Saving…' : emailCred ? 'Update email' : 'Connect email'}
          </button>
        </div>
        {emMsg && (
          <div className={`note ${emMsg.kind === 'err' ? 'note-err' : 'note-ok'}`}>
            {emMsg.text}
          </div>
        )}
      </div>

      <div className="card" style={{ margin: '18px 0' }}>
        <div className="section-title">Office tools · Calendar</div>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Connect a calendar (CalDAV) so agents with <code>create_event</code> /{' '}
          <code>list_events</code>
          can book and read your schedule. Works with iCloud, Yahoo, Fastmail and any CalDAV server
          via an <strong>app-specific password</strong>. (Google and Outlook calendars need OAuth —
          coming with the sign-in-with-Google layer.)
        </p>
        {calCred && (
          <div
            className="note note-ok"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <span>
              Connected: <strong>{calCred.public.user}</strong> ({calCred.public.provider})
            </span>
            <button type="button" className="btn-delete" onClick={removeCalendar}>
              Disconnect
            </button>
          </div>
        )}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="cal-provider">Provider</label>
            <select
              id="cal-provider"
              value={calProvider}
              onChange={(e) => setCalProvider(e.target.value)}
            >
              {(caldavProviders.length
                ? caldavProviders
                : ['icloud', 'yahoo', 'fastmail', 'custom']
              ).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cal-user">Account email</label>
            <input
              id="cal-user"
              value={calUser}
              onChange={(e) => setCalUser(e.target.value)}
              placeholder="you@icloud.com"
            />
          </div>
          <div className="field">
            <label htmlFor="cal-pass">App password</label>
            <input
              id="cal-pass"
              type="password"
              value={calPass}
              onChange={(e) => setCalPass(e.target.value)}
              placeholder="app-specific password"
            />
          </div>
          {calProvider === 'custom' && (
            <div className="field">
              <label htmlFor="cal-server">CalDAV server URL</label>
              <input
                id="cal-server"
                value={calServer}
                onChange={(e) => setCalServer(e.target.value)}
                placeholder="https://cloud.example.com/remote.php/dav"
              />
            </div>
          )}
        </div>
        <div className="gen-actions">
          <button
            type="button"
            className="btn act"
            disabled={
              calBusy ||
              !calUser.trim() ||
              !calPass ||
              (calProvider === 'custom' && !calServer.trim())
            }
            onClick={saveCalendar}
          >
            {calBusy ? 'Saving…' : calCred ? 'Update calendar' : 'Connect calendar'}
          </button>
        </div>
        {calMsg && (
          <div className={`note ${calMsg.kind === 'err' ? 'note-err' : 'note-ok'}`}>
            {calMsg.text}
          </div>
        )}
      </div>

      <div className="card" style={{ margin: '18px 0' }}>
        <div className="section-title">Add a custom connector</div>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Register any integration not in the catalogue — point it at a webhook or API endpoint.
        </p>
        <div className="conn-templates">
          <span className="hint">Quick start · web search:</span>
          <div className="chip-pick">
            {TEMPLATES.map((t) => (
              <button
                type="button"
                key={t.id}
                className="chip-toggle"
                onClick={() => applyTemplate(t)}
                title={t.description}
              >
                {t.name}
                {t.needsKey ? '' : ' · no key'}
              </button>
            ))}
          </div>
          <span className="hint">
            Fills the form below — then attach it to the Genesis brain so the assistant can research
            and design agents.
          </span>
        </div>
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
            <span className="hint">
              use <code>{'{{query}}'}</code> to inject the agent's question
            </span>
          </div>
          <div className="field">
            <label htmlFor="c-method">Method</label>
            <select
              id="c-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
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
          <div className="field wide">
            <label htmlFor="c-headers">Headers — auth goes here (one per line, "Key: Value")</label>
            <textarea
              id="c-headers"
              rows={3}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder={'Authorization: Bearer sk-...\nX-API-Key: ...'}
            />
            <span className="hint">
              kept server-side on the node and redacted from the API — values are never shown again
              after saving
            </span>
          </div>
          {method === 'POST' && (
            <div className="field wide">
              <label htmlFor="c-body">Request body (POST)</label>
              <textarea
                id="c-body"
                rows={3}
                value={reqBody}
                onChange={(e) => setReqBody(e.target.value)}
                placeholder={'{"q": "{{query}}"}'}
              />
              <span className="hint">
                defaults to <code>{'{"query": "…"}'}</code> if left blank
              </span>
            </div>
          )}
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
                {c.endpoint && (
                  <div className="mono-hash">
                    <span className="chip" style={{ marginRight: 6 }}>
                      {c.method ?? 'GET'}
                    </span>
                    {c.endpoint}
                  </div>
                )}
                {c.headers && c.headers.length > 0 && (
                  <div className="hint" style={{ marginTop: 4 }}>
                    auth: {c.headers.map((h) => h.key).join(', ')}
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 8,
                  }}
                >
                  <span className="hint">added by {c.createdBy}</span>
                  <button
                    type="button"
                    className="btn-delete"
                    onClick={() => removeConnector(c)}
                    title="Delete this connector"
                    aria-label={`Delete ${c.name}`}
                  >
                    Delete
                  </button>
                </div>
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
