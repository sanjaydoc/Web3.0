import { useEffect, useState } from 'react';
import { type HostedAgent, api, formatAmount } from './api.js';

const ADMIN_KEY = 'acp.adminToken';
const CREATOR_KEY = 'acp.creatorName';

/**
 * HostedDapps — the catalogue of dApps/agents running inside this node. Scoped by ownership: the
 * node owner (holds the admin token, or runs an open single-user node) sees every developer's
 * dApps; a regular developer sees only the ones they published (matched by their creator name).
 */
export function HostedDapps({ admin = false }: { admin?: boolean }) {
  const [items, setItems] = useState<HostedAgent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [adminRequired, setAdminRequired] = useState(false);
  const [me, setMe] = useState(() => localStorage.getItem(CREATOR_KEY) ?? '');
  const [scope, setScope] = useState<'all' | 'mine'>('all');

  useEffect(() => {
    const load = () => {
      api
        .hosted()
        .then((r) => {
          setItems(r.agents);
          setAdminRequired(r.adminRequired);
          setOnline(true);
        })
        .catch(() => setOnline(false));
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  // Owner = holds the admin token, or the node requires no admin (your own single-user node).
  // Only Admin mode may view every developer's dApps; Operators always see just their own.
  const isOwner = !adminRequired || Boolean(localStorage.getItem(ADMIN_KEY));
  const canSeeAll = admin && isOwner;
  const effectiveScope = canSeeAll ? scope : 'mine';
  const mine = (h: HostedAgent) => Boolean(me) && h.createdBy.toLowerCase() === me.toLowerCase();
  const shown = effectiveScope === 'all' ? items : items.filter(mine);

  const active = shown.find((i) => i.web3Id === selected) ?? null;
  const dapps = shown.filter((i) => i.kind === 'webhook').length;
  const agents = shown.filter((i) => i.kind === 'llm').length;
  const toggle = (id: string) => setSelected((cur) => (cur === id ? null : id));
  const saveMe = (v: string) => {
    setMe(v);
    localStorage.setItem(CREATOR_KEY, v);
  };
  const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '—');

  return (
    <>
      <div className="page-head">
        <h1>Hosted dApps</h1>
        <span className="muted">
          {shown.length} shown · {dapps} dApp{dapps === 1 ? '' : 's'} · {agents} agent
          {agents === 1 ? '' : 's'}
          {effectiveScope === 'all' ? ' — all developers' : ' — yours only'}
        </span>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="scope-bar">
          {canSeeAll ? (
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
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <input
              value={me}
              onChange={(e) => saveMe(e.target.value)}
              placeholder="You are (creator name) — e.g. Dr. Sanjay Anbu"
            />
          </div>
          {canSeeAll && <span className="chip allow">admin view</span>}
        </div>
      </div>

      <div className="card">
        {!online ? (
          <div className="empty">Node offline — can't reach /hosted.</div>
        ) : shown.length === 0 ? (
          <div className="empty">
            {effectiveScope === 'mine' && !me
              ? 'Enter your creator name above to see the dApps you published.'
              : effectiveScope === 'mine'
                ? `No hosted dApps created by "${me}" yet.`
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
