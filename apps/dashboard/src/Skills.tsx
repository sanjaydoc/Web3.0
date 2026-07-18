import type { AgentCard } from './api.js';
import { formatAmount } from './api.js';

interface SkillRow {
  id: string;
  name: string;
  description: string;
  providers: { web3Id: string; price?: number; currency?: string }[];
}

/** Aggregate every skill advertised across the registry into a "what can the network do" catalog. */
function catalog(agents: AgentCard[]): SkillRow[] {
  const map = new Map<string, SkillRow>();
  for (const agent of agents) {
    for (const skill of agent.skills ?? []) {
      const row = map.get(skill.id) ?? {
        id: skill.id,
        name: skill.name,
        description: skill.description,
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
  return [...map.values()].sort((a, b) => b.providers.length - a.providers.length);
}

export function Skills({ agents }: { agents: AgentCard[] }) {
  const rows = catalog(agents);
  return (
    <>
      <div className="page-head">
        <h1>Skills</h1>
        <span className="muted">what agents across the network can do — and who offers it</span>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">No skills advertised yet — launch an agent from Genesis.</div>
      ) : (
        <div className="grid-2">
          {rows.map((s) => (
            <div className="card" key={s.id}>
              <div
                className="section-title"
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                <code>{s.id}</code>
                <span className="chip">
                  {s.providers.length} provider{s.providers.length > 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <p className="muted" style={{ margin: '4px 0 10px' }}>
                {s.description}
              </p>
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
            </div>
          ))}
        </div>
      )}
    </>
  );
}
