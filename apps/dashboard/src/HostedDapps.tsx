import { useEffect, useState } from 'react';
import { type HostedAgent, api, formatAmount } from './api.js';

/**
 * HostedDapps — the catalogue of everything running *inside* this node: developer dApps (webhook
 * endpoints) and Genesis LLM agents. A list view shows who created each one; clicking a row opens
 * the full record (identity, endpoint/brain, pricing, wallet, timestamps).
 */
export function HostedDapps() {
  const [items, setItems] = useState<HostedAgent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const load = () => {
      api
        .hosted()
        .then((r) => {
          setItems(r.agents);
          setOnline(true);
        })
        .catch(() => setOnline(false));
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const active = items.find((i) => i.web3Id === selected) ?? null;
  const dapps = items.filter((i) => i.kind === 'webhook').length;
  const agents = items.filter((i) => i.kind === 'llm').length;
  const toggle = (id: string) => setSelected((cur) => (cur === id ? null : id));

  const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '—');

  return (
    <>
      <div className="page-head">
        <h1>Hosted dApps</h1>
        <span className="muted">
          {items.length} hosted · {dapps} dApp{dapps === 1 ? '' : 's'} · {agents} agent
          {agents === 1 ? '' : 's'} — running inside this node
        </span>
      </div>

      <div className="card">
        {!online ? (
          <div className="empty">Node offline — can't reach /hosted.</div>
        ) : items.length === 0 ? (
          <div className="empty">
            Nothing hosted yet. Publish a dApp in <b>Developers</b> or launch an agent in{' '}
            <b>Genesis</b>.
          </div>
        ) : (
          <table className="rows-click">
            <thead>
              <tr>
                <th>Web3.0 ID</th>
                <th>Kind</th>
                <th>Created by</th>
                <th>Skill</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr
                  key={h.web3Id}
                  className={`clickable ${selected === h.web3Id ? 'sel' : ''}`}
                  tabIndex={0}
                  onClick={() => toggle(h.web3Id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(h.web3Id);
                    }
                  }}
                >
                  <td>
                    <strong>{h.web3Id}</strong>
                  </td>
                  <td>
                    <span className={`chip ${h.kind === 'webhook' ? 'allow' : ''}`}>
                      {h.kind === 'webhook' ? 'dApp' : 'agent'}
                    </span>
                  </td>
                  <td>{h.createdBy}</td>
                  <td>{h.skill}</td>
                  <td>
                    {formatAmount(h.price)}
                    <span className="muted">/call</span>
                  </td>
                  <td>
                    <span className={`chip ${h.running ? 'allow' : 'deny'}`}>
                      {h.running ? 'running' : 'stopped'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {active && (
        <div className="card" style={{ marginTop: 18 }}>
          <div
            className="section-title"
            style={{ display: 'flex', justifyContent: 'space-between' }}
          >
            <span>{active.name}</span>
            <span className={`chip ${active.running ? 'allow' : 'deny'}`}>
              {active.running ? 'running' : 'stopped'}
            </span>
          </div>
          <dl className="kv">
            <dt>Web3.0 ID</dt>
            <dd className="mono-hash">{active.web3Id}</dd>
            <dt>Kind</dt>
            <dd>{active.kind === 'webhook' ? 'dApp (external webhook)' : 'agent (LLM brain)'}</dd>
            <dt>Created by</dt>
            <dd>{active.createdBy}</dd>
            <dt>Created at</dt>
            <dd>{when(active.createdAt)}</dd>
            <dt>Description</dt>
            <dd>{active.description || '—'}</dd>
            <dt>Skill</dt>
            <dd>{active.skill}</dd>
            <dt>Price</dt>
            <dd>{formatAmount(active.price)} / call</dd>
            <dt>Wallet</dt>
            <dd>{formatAmount(active.walletBalance)}</dd>
            <dt>DID</dt>
            <dd className="mono-hash">{active.did || '—'}</dd>
            {active.kind === 'webhook' ? (
              <>
                <dt>Endpoint</dt>
                <dd className="mono-hash">{active.webhookUrl || '—'}</dd>
              </>
            ) : (
              <>
                <dt>Brain</dt>
                <dd>
                  {active.provider}/{active.model}
                  {active.hasKey ? ' · key set (server-side)' : ' · no key'}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </>
  );
}
