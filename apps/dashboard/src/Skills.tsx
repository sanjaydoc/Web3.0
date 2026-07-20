import { useCallback, useEffect, useState } from 'react';
import { type AgentCard, type SkillDef, api, formatAmount } from './api.js';

interface SkillRow {
  id: string;
  name: string;
  description: string;
  registered: boolean; // true if it exists in the catalogue (not just advertised by an agent)
  createdBy?: string;
  providers: { web3Id: string; price?: number; currency?: string }[];
}

/** Merge catalogue skills with the skills advertised by registered agents into one list. */
function merge(catalogue: SkillDef[], agents: AgentCard[]): SkillRow[] {
  const map = new Map<string, SkillRow>();
  for (const s of catalogue) {
    map.set(s.id, {
      id: s.id,
      name: s.name,
      description: s.description,
      registered: true,
      createdBy: s.createdBy,
      providers: [],
    });
  }
  for (const agent of agents) {
    for (const skill of agent.skills ?? []) {
      const row = map.get(skill.id) ?? {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        registered: false,
        providers: [],
      };
      row.providers.push({
        web3Id: agent.web3Id,
        price: agent.pricing?.perTask,
        currency: agent.pricing?.currency,
      });
      map.set(skill.id, row);
    }
  }
  return [...map.values()].sort(
    (a, b) => b.providers.length - a.providers.length || a.id.localeCompare(b.id),
  );
}

export function Skills({ agents }: { agents: AgentCard[] }) {
  const [catalogue, setCatalogue] = useState<SkillDef[]>([]);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api
      .skills()
      .then((r) => setCatalogue(r.skills))
      .catch(() => setCatalogue([]));
  }, []);
  useEffect(() => refresh(), [refresh]);

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      const s = await api.createSkill({ id: id.trim(), name: name.trim(), description });
      setMsg({ kind: 'ok', text: `Skill "${s.id}" created.` });
      setId('');
      setName('');
      setDescription('');
      refresh();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const rows = merge(catalogue, agents);

  return (
    <>
      <div className="page-head">
        <h1>Skills</h1>
        <span className="muted">what agents across the network can do — and who offers it</span>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Create a skill</div>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Define a new capability so agents and dApps can advertise it. Skills you register appear
          below even before anyone offers them.
        </p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sk-id">Skill id</label>
            <input
              id="sk-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="summarize"
            />
            <span className="hint">lowercase letters, digits, hyphens</span>
          </div>
          <div className="field">
            <label htmlFor="sk-name">Name</label>
            <input
              id="sk-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Summarize text"
            />
          </div>
          <div className="field wide">
            <label htmlFor="sk-desc">Description</label>
            <input
              id="sk-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Condense a document into a short summary."
            />
          </div>
        </div>
        <div className="gen-actions">
          <button
            type="button"
            className="btn act"
            disabled={busy || !id.trim() || !name.trim()}
            onClick={create}
          >
            {busy ? 'Creating…' : 'Create skill'}
          </button>
        </div>
        {msg && (
          <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card empty">
          No skills yet — create one above, or launch an agent from Genesis.
        </div>
      ) : (
        <div className="grid-2">
          {rows.map((s) => (
            <div className="card" key={s.id}>
              <div
                className="section-title"
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                <code>{s.id}</code>
                <span className={`chip ${s.registered ? 'allow' : ''}`}>
                  {s.providers.length} provider{s.providers.length === 1 ? '' : 's'}
                </span>
              </div>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <p className="muted" style={{ margin: '4px 0 10px' }}>
                {s.description || '—'}
              </p>
              {s.providers.length === 0 ? (
                <p className="hint">
                  Registered{s.createdBy ? ` by ${s.createdBy}` : ''} — no providers yet.
                </p>
              ) : (
                <ul className="kv-list">
                  {s.providers.map((p) => (
                    <li key={p.web3Id}>
                      <code>{p.web3Id}</code>
                      <span className="muted">
                        {p.price ? formatAmount(p.price, p.currency) : 'free'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
