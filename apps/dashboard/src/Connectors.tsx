import { useEffect, useState } from 'react';
import { type ConsensusInfo, type SettlementInfo, type TelegramStatus, api } from './api.js';

interface Connector {
  name: string;
  kind: string;
  on: boolean;
  detail: string;
  view?: string;
}

/**
 * Connectors — the node's outward integrations and pluggable rails at a glance: the Telegram front
 * door, the settlement rail, and the distributed-L1 link. Each is configured elsewhere; this is the
 * ops overview of what's wired up.
 */
export function Connectors({ go }: { go?: (view: string) => void }) {
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [settle, setSettle] = useState<SettlementInfo | null>(null);
  const [cons, setCons] = useState<ConsensusInfo | null>(null);

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
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const connectors: Connector[] = [
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
          outward links &amp; pluggable rails — all managed here, nothing in config files
        </span>
      </div>

      <div className="grid-2">
        {connectors.map((c) => (
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
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              {c.kind}
            </div>
            <div style={{ marginTop: 6 }}>{c.detail}</div>
            {c.view && go && <div className="conn-cta">Configure →</div>}
          </button>
        ))}
      </div>
    </>
  );
}
