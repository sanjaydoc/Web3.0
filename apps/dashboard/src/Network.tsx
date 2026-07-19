import { useEffect, useRef, useState } from 'react';
import { type ConsensusInfo, type SettlementInfo, type Stats, api } from './api.js';

// Rough continent outlines in [lon, lat] — enough to render a recognizable dot-map world.
const CONTINENTS: [number, number][][] = [
  [
    [-168, 65],
    [-140, 71],
    [-95, 70],
    [-60, 50],
    [-80, 25],
    [-105, 15],
    [-125, 40],
    [-168, 65],
  ],
  [
    [-80, 10],
    [-58, 5],
    [-35, -5],
    [-40, -25],
    [-60, -55],
    [-75, -50],
    [-82, -20],
    [-80, 10],
  ],
  [
    [-10, 60],
    [2, 58],
    [30, 60],
    [40, 50],
    [20, 40],
    [-5, 43],
    [-10, 60],
  ],
  [
    [-15, 35],
    [12, 35],
    [35, 32],
    [50, 10],
    [40, -12],
    [22, -35],
    [12, -30],
    [0, 5],
    [-15, 12],
    [-15, 35],
  ],
  [
    [32, 60],
    [62, 72],
    [120, 73],
    [170, 66],
    [150, 45],
    [122, 24],
    [100, 8],
    [76, 8],
    [58, 26],
    [44, 42],
    [32, 60],
  ],
  [
    [112, -12],
    [135, -11],
    [153, -28],
    [145, -40],
    [120, -35],
    [112, -25],
    [112, -12],
  ],
];

// Cities we drop network nodes onto (illustrative geography for a live ops view).
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

function inside(lon: number, lat: number, poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const landDots: [number, number][] = [];
for (let lon = -180; lon <= 180; lon += 2.6) {
  for (let lat = 74; lat >= -56; lat -= 2.6) {
    if (CONTINENTS.some((p) => inside(lon, lat, p))) {
      landDots.push([(lon + 180) / 360, (90 - lat) / 180]);
    }
  }
}
const cityUV = CITIES.map((c) => ({ ...c, u: (c.lon + 180) / 360, v: (90 - c.lat) / 180 }));

export function Network() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [cons, setCons] = useState<ConsensusInfo | null>(null);
  const [settle, setSettle] = useState<SettlementInfo | null>(null);
  const dataRef = useRef({ authorities: 1, agents: 0, online: 0 });

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

  useEffect(() => {
    dataRef.current = {
      authorities: cons?.enabled ? Math.max(1, cons.authorities.length) : 1,
      agents: stats?.agents ?? 0,
      online: stats?.online ?? 0,
    };
  }, [cons, stats]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    // Cache the glowing green landmass to an offscreen layer (glow is expensive per-frame).
    const land = document.createElement('canvas');
    const lctx = land.getContext('2d')!;
    let raf = 0;
    let W = 0;
    let H = 0;
    let mx = 0;
    let my = 0;
    let mw = 0;
    let mh = 0;

    const P = (u: number, v: number) => [mx + u * mw, my + v * mh] as const;

    const drawLand = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      land.width = W * dpr;
      land.height = H * dpr;
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.clearRect(0, 0, W, H);
      lctx.shadowColor = 'rgba(46,255,130,0.95)';
      lctx.shadowBlur = 5;
      lctx.fillStyle = 'rgba(66,255,150,0.92)';
      for (const [u, v] of landDots) {
        lctx.fillRect(mx + u * mw, my + v * mh, 1.7, 1.7);
      }
    };

    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // map rect (equirectangular ~2:1), centred, leaving margins for the HUD
      mw = Math.min(W - 48, (H - 120) * 2);
      mh = mw / 2;
      mx = (W - mw) / 2;
      my = (H - mh) / 2 + 8;
      drawLand();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let t = 0;

    const frame = () => {
      t += 0.016;
      ctx.clearRect(0, 0, W, H);

      // background — deep navy vignette
      const bg = ctx.createRadialGradient(
        W / 2,
        H * 0.46,
        0,
        W / 2,
        H * 0.46,
        Math.max(W, H) * 0.8,
      );
      bg.addColorStop(0, '#0a1a2b');
      bg.addColorStop(0.55, '#06101b');
      bg.addColorStop(1, '#03060c');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      // soft green bloom behind the map
      const bloom = ctx.createRadialGradient(
        mx + mw / 2,
        my + mh / 2,
        0,
        mx + mw / 2,
        my + mh / 2,
        mw * 0.55,
      );
      bloom.addColorStop(0, 'rgba(30,230,120,0.12)');
      bloom.addColorStop(1, 'rgba(30,230,120,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, W, H);

      // glowing green landmass (cached)
      ctx.drawImage(land, 0, 0, land.width, land.height, 0, 0, W, H);

      const { authorities, agents } = dataRef.current;
      const auth = cityUV.slice(0, Math.min(authorities, cityUV.length));

      // consensus arcs between nodes — green glow
      ctx.save();
      ctx.shadowColor = 'rgba(46,255,130,0.7)';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(70,255,150,0.32)';
      ctx.setLineDash([2, 6]);
      ctx.lineDashOffset = -t * 26;
      for (let i = 0; i < auth.length; i++) {
        for (let j = i + 1; j < auth.length; j++) {
          const [ax, ay] = P(auth[i]!.u, auth[i]!.v);
          const [bx, by] = P(auth[j]!.u, auth[j]!.v);
          const midx = (ax + bx) / 2;
          const midy = (ay + by) / 2 - Math.abs(ax - bx) * 0.18;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo(midx, midy, bx, by);
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.setLineDash([]);

      // agent swarm — small green dots near cities
      ctx.save();
      ctx.shadowColor = 'rgba(46,255,130,0.6)';
      ctx.shadowBlur = 4;
      ctx.fillStyle = 'rgba(110,255,170,0.6)';
      const shown = Math.min(agents, 60);
      for (let i = 0; i < shown; i++) {
        const c = cityUV[(i * 3) % cityUV.length]!;
        const a = i * 2.399;
        const rad = 0.008 + ((i * 37) % 20) / 900;
        const [x, y] = P(c.u + Math.cos(a) * rad, c.v + Math.sin(a) * rad * 2);
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, 7);
        ctx.fill();
      }
      ctx.restore();

      // node markers — RED neon pulsing dots
      const col = '255,58,84';
      auth.forEach((c, i) => {
        const [x, y] = P(c.u, c.v);
        const isHome = i === 0;
        const pr = 6 + (Math.sin(t * 2 + i) * 0.5 + 0.5) * 11;
        ctx.save();
        ctx.shadowColor = `rgba(${col},0.95)`;
        ctx.shadowBlur = 12;
        // pulse ring
        ctx.strokeStyle = `rgba(${col},${Math.max(0, 0.55 - pr / 40)})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(x, y, pr, 0, 7);
        ctx.stroke();
        // bloom
        const gr = ctx.createRadialGradient(x, y, 0, x, y, 15);
        gr.addColorStop(0, `rgba(${col},0.95)`);
        gr.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, 7);
        ctx.fill();
        // core
        ctx.fillStyle = `rgb(${col})`;
        ctx.beginPath();
        ctx.arc(x, y, isHome ? 4 : 3, 0, 7);
        ctx.fill();
        ctx.restore();
        // label
        ctx.fillStyle = 'rgba(220,235,245,0.9)';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(`${c.n}${isHome ? ' · you' : ''}`, x + 9, y + 3);
      });

      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const online = cons?.enabled ? cons.authorities.length : stats ? 1 : 0;

  return (
    <>
      <div className="page-head">
        <h1>Network</h1>
        <span className="muted">live operations map — active nodes, agents, and the chain</span>
      </div>

      <div className="netmap" ref={wrapRef}>
        <canvas ref={canvasRef} />

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
