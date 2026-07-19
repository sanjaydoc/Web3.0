import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type ConsensusInfo, type SettlementInfo, type Stats, api } from './api.js';
import { WORLD_PATHS, WORLD_VIEWBOX } from './worldMap.js';

const VB_W = 1010;
const VB_H = 666;

// Cities we drop network nodes / agents onto (illustrative geography for a live ops view).
const CITIES: { n: string; lon: number; lat: number }[] = [
  { n: 'SFO', lon: -122, lat: 37 },
  { n: 'NYC', lon: -74, lat: 40 },
  { n: 'LON', lon: -0.1, lat: 51 },
  { n: 'FRA', lon: 8, lat: 50 },
  { n: 'SIN', lon: 103, lat: 1.3 },
  { n: 'TOK', lon: 139, lat: 35 },
  { n: 'GRU', lon: -46, lat: -23 },
  { n: 'SYD', lon: 151, lat: -33 },
  { n: 'BOM', lon: 72, lat: 19 },
  { n: 'JNB', lon: 28, lat: -26 },
];

// Web Mercator, calibrated to the @svg-maps/world 1010x666 viewBox.
function proj(lon: number, lat: number): { x: number; y: number } {
  const x = 505 + 2.75 * lon;
  const phi = (Math.max(-82, Math.min(82, lat)) * Math.PI) / 180;
  const ymerc = Math.log(Math.tan(Math.PI / 4 + phi / 2));
  return { x, y: 435 - 214.7 * ymerc };
}

const cityXY = CITIES.map((c) => ({ ...c, ...proj(c.lon, c.lat) }));

export function Network() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [cons, setCons] = useState<ConsensusInfo | null>(null);
  const [settle, setSettle] = useState<SettlementInfo | null>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const load = () => {
      api
        .stats()
        .then(setStats)
        .catch(() => undefined);
      api
        .consensus()
        .then(setCons)
        .catch(() => undefined);
      api
        .settlement()
        .then(setSettle)
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const authorities = cons?.enabled ? Math.max(1, cons.authorities.length) : 1;
  const agentCount = stats?.agents ?? 0;
  const nodeCities = cityXY.slice(0, Math.min(authorities, cityXY.length));

  // Scatter agents deterministically near the cities.
  const agentDots = useMemo(() => {
    const shown = Math.min(agentCount, 80);
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < shown; i++) {
      const c = cityXY[(i * 3) % cityXY.length]!;
      const a = i * 2.399;
      const r = 6 + ((i * 37) % 22);
      out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r * 0.7 });
    }
    return out;
  }, [agentCount]);

  // --- pan / zoom (SVG group transform in viewBox units) ---
  const toUser = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    return {
      x: clientX * inv.a + clientY * inv.c + inv.e,
      y: clientX * inv.b + clientY * inv.d + inv.f,
    };
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const u = toUser(e.clientX, e.clientY);
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      const s = Math.max(1, Math.min(9, v.s * factor));
      const lx = (u.x - v.x) / v.s;
      const ly = (u.y - v.y) / v.s;
      return { s, x: u.x - lx * s, y: u.y - ly * s };
    });
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const svg = svgRef.current!;
    const ctm = svg.getScreenCTM();
    const scale = ctm ? ctm.a : 1;
    const dx = (e.clientX - drag.current.px) / scale;
    const dy = (e.clientY - drag.current.py) / scale;
    setView((v) => ({ ...v, x: drag.current!.x + dx, y: drag.current!.y + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const zoomBy = (factor: number) =>
    setView((v) => {
      const s = Math.max(1, Math.min(9, v.s * factor));
      const cx = VB_W / 2;
      const cy = VB_H / 2;
      const lx = (cx - v.x) / v.s;
      const ly = (cy - v.y) / v.s;
      return { s, x: cx - lx * s, y: cy - ly * s };
    });
  const reset = () => setView({ s: 1, x: 0, y: 0 });

  const online = cons?.enabled ? cons.authorities.length : stats ? 1 : 0;

  return (
    <>
      <div className="page-head">
        <h1>Network</h1>
        <span className="muted">live operations map — scroll to zoom, drag to pan</span>
      </div>

      <div className="netmap">
        <svg
          ref={svgRef}
          className="netmap-svg"
          viewBox={WORLD_VIEWBOX}
          preserveAspectRatio="xMidYMid meet"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <title>ACP network map</title>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>
            <g className="world">
              {WORLD_PATHS.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
            {agentDots.map((a, i) => (
              <circle key={`a${i}`} className="net-agent" cx={a.x} cy={a.y} r={1.6 / view.s} />
            ))}
            {nodeCities.map((c, i) => (
              <g key={c.n}>
                <circle className="net-ring" cx={c.x} cy={c.y} r={9 / view.s} />
                <circle className="net-node" cx={c.x} cy={c.y} r={4 / view.s} />
                <text
                  className="net-label"
                  x={c.x + 7 / view.s}
                  y={c.y + 3 / view.s}
                  style={{ fontSize: `${11 / view.s}px` }}
                >
                  {c.n}
                  {i === 0 ? ' · you' : ''}
                </text>
              </g>
            ))}
          </g>
        </svg>

        <div className="net-hud net-tl">
          <div className="net-title">ACP · NETWORK OPS</div>
          <div className={`net-status ${stats ? 'ok' : 'bad'}`}>
            <span className="dot" /> {stats ? 'OPERATIONAL' : 'NODE OFFLINE'}
          </div>
        </div>

        <div className="net-hud net-tr net-metrics">
          <div>
            <b>{online}</b>
            <span>NODES</span>
          </div>
          <div>
            <b>{stats?.agents ?? '—'}</b>
            <span>AGENTS</span>
          </div>
          <div>
            <b>{stats?.online ?? '—'}</b>
            <span>ONLINE</span>
          </div>
          <div>
            <b>{cons?.height ?? stats?.ledgerEntries ?? '—'}</b>
            <span>{cons?.enabled ? 'BLOCKS' : 'ENTRIES'}</span>
          </div>
        </div>

        <div className="net-zoom">
          <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={reset} aria-label="Reset view">
            ⤢
          </button>
        </div>

        <div className="net-hud net-bl net-legend">
          <span>
            <i style={{ background: '#ff3a54' }} /> active node
          </span>
          <span>
            <i style={{ background: '#42ff96' }} /> agent
          </span>
          <span className={stats?.ledgerVerified ? 'v-ok' : 'v-bad'}>
            chain {stats?.ledgerVerified ? 'verified ✓' : '—'}
          </span>
        </div>

        <div className="net-hud net-br net-rails">
          <div>
            consensus · <b>{cons?.enabled ? `PoA ${cons.authorities.length}` : 'solo'}</b>
          </div>
          <div>
            settlement · <b>{settle ? settle.mode : '—'}</b>
          </div>
        </div>
      </div>
    </>
  );
}
