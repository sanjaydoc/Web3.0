import { useCallback, useEffect, useState } from 'react';
import {
  type ConsensusInfo,
  type HostedAgent,
  NODE_URL,
  type NodeInfo,
  type SettlementInfo,
  api,
} from './api.js';

const ADMIN_KEY = 'web3.adminToken';

function Snippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="gen-actions" style={{ margin: '0 0 8px' }}>
        <span className="section-title" style={{ margin: 0 }}>
          {title}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            navigator.clipboard.writeText(code).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => undefined,
            );
          }}
        >
          {copied ? 'copied ✓' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Developers() {
  const [info, setInfo] = useState<NodeInfo | null>(null);
  const [cons, setCons] = useState<ConsensusInfo | null>(null);
  const [settle, setSettle] = useState<SettlementInfo | null>(null);
  const [dapps, setDapps] = useState<HostedAgent[]>([]);
  const [adminRequired, setAdminRequired] = useState(false);

  const [admin, setAdmin] = useState(() => localStorage.getItem(ADMIN_KEY) ?? '');
  const [handle, setHandle] = useState('weatherbot');
  const [name, setName] = useState('Weather dApp');
  const [skillId, setSkillId] = useState('ask');
  const [price, setPrice] = useState('1.00');
  const [endpoint, setEndpoint] = useState('https://your-service.example/web3');
  const [createdBy, setCreatedBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    api
      .info()
      .then(setInfo)
      .catch(() => undefined);
    api
      .consensus()
      .then(setCons)
      .catch(() => undefined);
    api
      .settlement()
      .then(setSettle)
      .catch(() => undefined);
    api
      .hosted()
      .then((r) => {
        setDapps(r.agents.filter((a) => a.kind === 'webhook'));
        setAdminRequired(r.adminRequired);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const rememberAdmin = (v: string) => {
    setAdmin(v);
    localStorage.setItem(ADMIN_KEY, v);
  };

  async function publish() {
    setBusy(true);
    setMsg(null);
    try {
      const minor = Math.max(0, Math.round(Number.parseFloat(price || '0') * 100));
      await api.hostedLaunch(
        {
          handle,
          name,
          description: `${name} — a dApp on Web3.0`,
          skillId,
          skillName: skillId,
          skillDesc: `${name} endpoint`,
          price: minor,
          provider: 'http',
          model: 'webhook',
          webhookUrl: endpoint,
          createdBy: createdBy.trim() || undefined,
        },
        admin,
      );
      if (createdBy.trim()) localStorage.setItem('web3.creatorName', createdBy.trim());
      setMsg({
        kind: 'ok',
        text: `Published ${handle}@web3.0 — tasks now forward to your endpoint.`,
      });
      refresh();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const pySnippet = `# pip install -e packages/web3-sdk-py
from web3_sdk import Agent

app = Agent("myapp", name="My dApp", base_url="${NODE_URL}",
            skills=[{"id": "ask", "name": "Ask", "description": "…", "tags": []}],
            pricing={"perTask": 100, "currency": "aETH"})

@app.on_task
def handle(agent, msg):
    q = msg["body"]["input"]["question"]
    agent.reply_result(msg["from"], msg["body"]["taskId"], {"answer": f"you said: {q}"})

app.register(); app.connect()   # now live on Web3.0`;

  const webhookSnippet = `// Your dApp is just an HTTP endpoint. The node forwards each task as:
//   POST ${endpoint}
//   { "input": { "question": "…" } }
// Return JSON: { "answer": "…" }  (or any object)

app.post("/web3", (req, res) => {
  const { question } = req.body.input;
  res.json({ answer: \`echo: \${question}\` });
});`;

  const curlSnippet = `# Discover agents & the network
curl ${NODE_URL}/agents
curl ${NODE_URL}/consensus
curl ${NODE_URL}/settlement`;

  return (
    <>
      <div className="page-head">
        <h1>Developers</h1>
        <span className="muted">
          build on Web3.0 — publish an agent or a dApp, pay-per-call in aETH
        </span>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Your network</div>
        <dl className="kv">
          <dt>Node URL</dt>
          <dd className="mono-hash">{NODE_URL}</dd>
          <dt>Network</dt>
          <dd>
            {info?.name ?? '—'} · v{info?.version ?? '—'}
          </dd>
          <dt>Consensus</dt>
          <dd>
            {cons
              ? cons.enabled
                ? `PoA · ${cons.authorities.length} authorities · height ${cons.height}`
                : 'solo node'
              : '—'}
          </dd>
          <dt>Settlement</dt>
          <dd>{settle ? `${settle.mode} · ${settle.network}` : '—'}</dd>
          <dt>Modules</dt>
          <dd>{info?.modules?.join(' · ') ?? '—'}</dd>
        </dl>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Publish a dApp</div>
        <p className="muted" style={{ margin: '2px 0 12px' }}>
          Turn any HTTP endpoint into an agent on Web3.0. The node registers it, gives it a wallet,
          and forwards paid tasks to your URL — no agent code to run.
        </p>
        {adminRequired && (
          <div className="field wide">
            <label htmlFor="d-admin">Admin token</label>
            <input
              id="d-admin"
              type="password"
              value={admin}
              onChange={(e) => rememberAdmin(e.target.value)}
              placeholder="required to publish on this node"
            />
          </div>
        )}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="d-handle">Web3.0 ID</label>
            <input id="d-handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
            <span className="hint">{handle || '…'}@web3.0</span>
          </div>
          <div className="field">
            <label htmlFor="d-name">Name</label>
            <input id="d-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="d-skill">Skill id</label>
            <input id="d-skill" value={skillId} onChange={(e) => setSkillId(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="d-price">Price / task (aETH)</label>
            <input id="d-price" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="d-creator">Created by (your name / team)</label>
            <input
              id="d-creator"
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              placeholder="e.g. Dr. Sanjay Anbu"
            />
          </div>
          <div className="field wide">
            <label htmlFor="d-endpoint">Endpoint URL (receives POST with the task input)</label>
            <input id="d-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
          </div>
        </div>
        <div className="gen-actions">
          <button type="button" className="btn act" disabled={busy} onClick={publish}>
            {busy ? 'Publishing…' : 'Publish dApp'}
          </button>
        </div>
        {msg && (
          <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
        )}
        {dapps.length > 0 && (
          <ul className="kv-list" style={{ marginTop: 14 }}>
            {dapps.map((d) => (
              <li key={d.web3Id}>
                <span>
                  <code>{d.web3Id}</code> · <span className="chip">{d.skill}</span>
                </span>
                <span className="muted">{(d.price / 100).toFixed(2)} aETH/call</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ display: 'grid', gap: 18 }}>
        <div className="section-title" style={{ margin: 0 }}>
          Quickstart
        </div>
        <Snippet title="Agent — Python SDK" code={pySnippet} />
        <Snippet title="dApp — any HTTP endpoint" code={webhookSnippet} />
        <Snippet title="Explore over HTTP" code={curlSnippet} />
        <p className="hint">
          Full spec in <code>docs/PROTOCOL.md</code> · SDK in <code>packages/web3-sdk-py</code> ·
          run your own node from the <b>Download</b> tab.
        </p>
      </div>
    </>
  );
}
