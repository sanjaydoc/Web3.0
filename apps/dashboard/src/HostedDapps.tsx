import { useEffect, useState } from 'react';
import { type HostedAgent, api, formatAmount } from './api.js';

/**
 * HostedDapps — the catalogue of dApps/agents running inside this node. Ownership is by account
 * address: the node server scopes a non-admin to only the dApps they published (returns `scopedTo`);
 * an admin receives every developer's dApps and can toggle between All developers and just their own.
 */
export function HostedDapps({ admin = false }: { admin?: boolean }) {
  const [items, setItems] = useState<HostedAgent[]>([]);
  const [scopedTo, setScopedTo] = useState<string | null>(null);
  const [myAddress, setMyAddress] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [scope, setScope] = useState<'all' | 'mine'>('all');

  useEffect(() => {
    api
      .me()
      .then((m) => setMyAddress(m.address))
      .catch(() => setMyAddress(''));
  }, []);

  useEffect(() => {
    const load = () => {
      api
        .hosted()
        .then((r) => {
          // This view lists dApps (webhooks) only — LLM agents live in Genesis.
          setItems(r.agents.filter((a) => a.kind === 'webhook'));
          setScopedTo(r.scopedTo ?? null);
          setOnline(true);
        })
        .catch(() => setOnline(false));
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  // The server already scopes a non-admin to their own dApps (scopedTo set) — show those as-is.
  // An admin receives everything and may filter to just their own by address.
  const serverScoped = scopedTo !== null;
  const canToggle = admin && !serverScoped;
  const mine = (h: HostedAgent) =>
    Boolean(myAddress) && h.createdBy.toLowerCase() === myAddress.toLowerCase();
  const shown = canToggle && scope === 'mine' ? items.filter(mine) : items;
  const showingMine = serverScoped || (canToggle && scope === 'mine');

  const active = shown.find((i) => i.web3Id === selected) ?? null;
  const toggle = (id: string) => setSelected((cur) => (cur === id ? null : id));
  const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '—');

  return (
    <>
      <div className="page-head">
        <h1>Hosted dApps</h1>
        <span className="muted">
          {shown.length} dApp{shown.length === 1 ? '' : 's'}
          {showingMine ? ' — yours only' : ' — all developers'}
        </span>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="scope-bar">
          {canToggle ? (
            <div className="role-toggle" role="group" aria-label="Scope">
              <button
                type="button"
                className={scope === 'all' ? 'active' : ''}
                onClick={() => setScope('all')}
              >
                All developers
              </button>
              <button
                type="button"
                className={scope === 'mine' ? 'active' : ''}
                onClick={() => setScope('mine')}
              >
                My apps
              </button>
            </div>
          ) : (
            <span className="chip">My apps</span>
          )}
          {myAddress && <span className="chip">{myAddress}</span>}
          {canToggle && <span className="chip allow">admin view</span>}
        </div>
      </div>

      <div className="card">
        {!online ? (
          <div className="empty">Node offline — can't reach /hosted.</div>
        ) : shown.length === 0 ? (
          <div className="empty">
            {showingMine
              ? `No hosted dApps published by ${myAddress || 'you'} yet — create one in Developers or Genesis.`
              : 'Nothing hosted yet. Publish a dApp in Developers or launch an agent in Genesis.'}
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
              {shown.map((h) => (
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
