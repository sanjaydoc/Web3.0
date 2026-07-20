import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type AuthorityRequest,
  type ConsensusInfo,
  type NodeLocation,
  type SettlementInfo,
  type Stats,
  api,
} from './api.js';
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

// Web Mercator, calibrated to the @svg-maps/world 1010x666 viewBox by least-squares fit against
// 14 known country centroids (rmse < 1px): x = 474.55 + 2.8095·lon, y = 462.86 − 159.83·merc(lat).
function proj(lon: number, lat: number): { x: number; y: number } {
  const x = 474.55 + 2.8095 * lon;
  const phi = (Math.max(-84, Math.min(84, lat)) * Math.PI) / 180;
  const ymerc = Math.log(Math.tan(Math.PI / 4 + phi / 2));
  return { x, y: 462.86 - 159.832 * ymerc };
}

// Put "you" at the city nearest the viewer, not a hardcoded one. The browser's UTC offset gives an
// approximate longitude (15° per hour) with no geolocation permission and no external IP lookup —
// UTC+5:30 (India) → ~82°E → BOM; UTC-8 → ~-120° → SFO.
const viewerLon = (-new Date().getTimezoneOffset() / 60) * 15;
const nearest = CITIES.reduce(
  (best, c, i) =>
    Math.abs(c.lon - viewerLon) < Math.abs(CITIES[best]!.lon - viewerLon) ? i : best,
  0,
);
const ORDERED = [CITIES[nearest]!, ...CITIES.filter((_, i) => i !== nearest)];
const cityXY = ORDERED.map((c) => ({ ...c, ...proj(c.lon, c.lat) }));

/** Admin-only queue: operators asking to join the authority set — approve or reject. */
function AuthorityQueue() {
  const [requests, setRequests] = useState<AuthorityRequest[]>([]);
  const [err, setErr] = useState('');

  const load = useCallback(
    () =>
      api
        .authorityRequests()
        .then((r) => setRequests(r.requests))
        .catch(() => undefined),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function decide(address: string, action: 'approve' | 'reject') {
    setErr('');
    try {
      await api.decideAuthority(address, action);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const pending = requests.filter((r) => r.status === 'pending');
  const approved = requests.filter((r) => r.status === 'approved');
  if (requests.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="section-title">Authority requests</div>
      {pending.length === 0 && <p className="muted">No pending requests.</p>}
      {pending.map((r) => (
        <div
          key={r.address}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '8px 0',
            borderTop: '1px solid var(--hair)',
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>{r.address}</b> <span className="muted">· asked {r.requestedAt.slice(0, 10)}</span>
            <div className="mono-hash">key {r.nodePublicKey.slice(0, 40)}…</div>
          </div>
          <button type="button" className="btn act" onClick={() => decide(r.address, 'approve')}>
            Approve
          </button>
          <button type="button" className="btn act" onClick={() => decide(r.address, 'reject')}>
            Reject
          </button>
        </div>
      ))}
      {approved.length > 0 && (
        <>
          <p className="muted" style={{ margin: '14px 0 6px' }}>
            Approved — seated <b>on-chain automatically</b> when the chain is live (the key rides in
            the next block and every node applies it; the new authority starts signing at its turn).
            On a solo node it's recorded for launch; these keys also seed{' '}
            <code>WEB3_AUTHORITIES</code> at genesis:
          </p>
          {approved.map((r) => (
            <div key={r.address} className="mono-hash" style={{ padding: '2px 0' }}>
              {r.nodePublicKey} <span className="muted">· {r.address}</span>
            </div>
          ))}
        </>
      )}
      {err && <div className="note note-err">{err}</div>}
    </div>
  );
}

export function Network() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [cons, setCons] = useState<ConsensusInfo | null>(null);
  const [settle, setSettle] = useState<SettlementInfo | null>(null);
  const [locations, setLocations] = useState<NodeLocation[]>([]);
  const [myAddress, setMyAddress] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    api
      .me()
      .then((a) => {
        setMyAddress(a.address);
        setIsAdmin(a.role === 'admin');
      })
      .catch(() => undefined);
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
      api
        .nodeLocations()
        .then((r) => setLocations(r.locations))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const authorities = cons?.enabled ? Math.max(1, cons.authorities.length) : 1;
  const agentCount = stats?.agents ?? 0;

  // Markers: real opt-in operator locations when any exist ("· you" = your account's entry);
  // otherwise fall back to the illustrative cities, nearest-timezone city first.
  const markers = useMemo(() => {
    if (locations.length > 0) {
      return locations.map((l) => ({
        key: l.address,
        n: l.label || l.address.split('@')[0] || 'node',
        you: myAddress !== null && l.address === myAddress,
        ...proj(l.lon, l.lat),
      }));
    }
    return cityXY
      .slice(0, Math.min(authorities, cityXY.length))
      .map((c, i) => ({ key: c.n, n: c.n, you: i === 0, x: c.x, y: c.y }));
  }, [locations, myAddress, authorities]);

  // Scatter agents deterministically near the markers.
  const agentDots = useMemo(() => {
    const shown = Math.min(agentCount, 80);
    const anchors = markers.length > 0 ? markers : cityXY;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < shown; i++) {
      const c = anchors[(i * 3) % anchors.length]!;
      const a = i * 2.399;
      const r = 6 + ((i * 37) % 22);
      out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r * 0.7 });
    }
    return out;
  }, [agentCount, markers]);

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
          <title>Web3.0 network map</title>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>
            <g className="world">
              {WORLD_PATHS.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
            {agentDots.map((a, i) => (
              <circle key={`a${i}`} className="net-agent" cx={a.x} cy={a.y} r={1.6 / view.s} />
            ))}
            {markers.map((c) => (
              <g key={c.key}>
                <circle className="net-ring" cx={c.x} cy={c.y} r={9 / view.s} />
                <circle className="net-node" cx={c.x} cy={c.y} r={4 / view.s} />
                <text
                  className="net-label"
                  x={c.x + 7 / view.s}
                  y={c.y + 3 / view.s}
                  style={{ fontSize: `${11 / view.s}px` }}
                >
                  {c.n}
                  {c.you ? ' · you' : ''}
                </text>
              </g>
            ))}
          </g>
        </svg>

        <div className="net-hud net-tl">
          <div className="net-title">Web3.0 · NETWORK OPS</div>
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

      {isAdmin && <AuthorityQueue />}
    </>
  );
}
