import { useEffect, useRef, useState } from 'react';
import { NODE_URL, type X402SelfTest, api, getWeb3Token, setWeb3Token } from './api.js';
import { generateAccountKey, loadAccountKey, saveAccountKey } from './txsign.js';

/**
 * First-run onboarding for a brand-new node operator, shown once on their OWN node (never on the
 * reserved main node). Three required steps — pick a name, drop your node on the map, choose how much
 * RAM to lend — then land on the dashboard. Each step reuses the SAME API the dashboard uses
 * (`api.signup` / `api.setNodeLocation` / `api.nodeLimits`), so there's one source of truth and the
 * existing views are untouched. Progress is shown as green-filling step cards.
 */

// RAM budget assumed per hosted agent — mirrors the node's `ramMbPerAgent` default so the capacity
// shown in onboarding matches what the node actually enforces at launch. Keep in sync with config.ts.
const RAM_MB_PER_AGENT = 256;
const RAM_PRESETS = [1, 2, 4, 8];

type StepState = 'done' | 'active' | 'todo';

function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div className="onboard-progress" aria-label={`Step ${Math.min(done + 1, total)} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static step bar
          key={i}
          className={`onboard-seg ${i < done ? 'filled' : ''}`}
        />
      ))}
    </div>
  );
}

/** A step wrapper card: green check + summary when done, expanded when active, dimmed when todo. */
function StepCard({
  n,
  title,
  state,
  summary,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  summary?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`onboard-card ${state}`}>
      <div className="onboard-card-head">
        <span className={`onboard-badge ${state === 'done' ? 'ok' : ''}`}>
          {state === 'done' ? '✓' : n}
        </span>
        <div className="onboard-card-title">
          <b>{title}</b>
          {state === 'done' && summary && <span className="muted"> — {summary}</span>}
        </div>
      </div>
      {state === 'active' && <div className="onboard-card-body">{children}</div>}
    </div>
  );
}

/** Step 1 — pick a handle; creates the account (name@web3.0) + signing key and signs in. The account's
 *  role is the persona chosen on the fork step: `operator` (host) or `agent-owner`. */
function NameStep({
  persona,
  onDone,
  onSignInInstead,
}: {
  persona: 'operator' | 'agent-owner';
  onDone: (address: string) => void;
  onSignInInstead: () => void;
}) {
  const [local, setLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const handle = local.trim().toLowerCase().replace(/\s+/g, '');

  async function create() {
    if (!handle) return;
    setBusy(true);
    setErr('');
    try {
      const key = generateAccountKey();
      const res = await api.signup(handle, persona, key.publicKey);
      saveAccountKey(res.address, key);
      setWeb3Token(res.token);
      localStorage.setItem('web3.creatorName', res.address);
      onDone(res.address);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted" style={{ margin: '0 0 12px' }}>
        Pick a handle — this is your identity and wallet on the network.
      </p>
      <div className="field">
        <label htmlFor="ob-name">Your name</label>
        <div className="onboard-handle">
          <input
            id="ob-name"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="e.g. max"
            onKeyDown={(e) => e.key === 'Enter' && create()}
            // biome-ignore lint/a11y/noAutofocus: first field of a focused wizard step
            autoFocus
          />
          <span className="onboard-suffix">@web3.0</span>
        </div>
        {handle && (
          <span className="hint">
            You'll be <b>{handle}@web3.0</b>
          </span>
        )}
      </div>
      {err && <div className="note note-err">{err}</div>}
      <div className="onboard-actions">
        <button type="button" className="btn act" disabled={!handle || busy} onClick={create}>
          {busy ? 'Creating…' : 'Create my account →'}
        </button>
        <button type="button" className="btn ghost" onClick={onSignInInstead}>
          I already have an account
        </button>
      </div>
    </>
  );
}

/** Step 2 — drop the node on the map. Reuses the same IP/GPS + PUT /operator/location flow. */
function LocationStep({ onDone }: { onDone: (label: string) => void }) {
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Key-less IP geolocation — the desktop app's Chromium has no Google geolocation key, so GPS often
  // fails there; this makes "Use my location" work everywhere (city-level, adjustable before saving).
  const ipLocate = async (): Promise<boolean> => {
    try {
      const res = await fetch('https://ipwho.is/');
      const d = (await res.json()) as {
        success?: boolean;
        latitude?: number;
        longitude?: number;
        city?: string;
      };
      if (d.success && typeof d.latitude === 'number' && typeof d.longitude === 'number') {
        setLat(d.latitude.toFixed(4));
        setLon(d.longitude.toFixed(4));
        if (d.city && !label) setLabel(d.city);
        setMsg({
          kind: 'ok',
          text: `Approx. location${d.city ? ` (${d.city})` : ''} — adjust if needed.`,
        });
        return true;
      }
    } catch {
      /* offline */
    }
    return false;
  };

  const useMyLocation = () => {
    setMsg(null);
    setBusy(true);
    const fallback = async () => {
      const ok = await ipLocate();
      setBusy(false);
      if (!ok) setMsg({ kind: 'err', text: 'Enter your coordinates manually below.' });
    };
    if (!navigator.geolocation) return void fallback();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(4));
        setLon(pos.coords.longitude.toFixed(4));
        setBusy(false);
        setMsg({ kind: 'ok', text: 'Location captured — Save to put your node on the map.' });
      },
      () => void fallback(),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  async function save() {
    const la = Number.parseFloat(lat);
    const lo = Number.parseFloat(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) {
      setMsg({ kind: 'err', text: 'A latitude and longitude are required.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api.setNodeLocation({ lat: la, lon: lo, label: label.trim() });
      onDone(saved.label || 'your location');
    } catch (e) {
      setBusy(false);
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <>
      <p className="muted" style={{ margin: '0 0 12px' }}>
        Put your node on the world map so the network can see where you're contributing from.
      </p>
      <button type="button" className="btn act" disabled={busy} onClick={useMyLocation}>
        {busy ? 'Locating…' : '📍 Use my location'}
      </button>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="ob-lat">Latitude</label>
          <input
            id="ob-lat"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="13.08"
          />
        </div>
        <div className="field">
          <label htmlFor="ob-lon">Longitude</label>
          <input
            id="ob-lon"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            placeholder="80.27"
          />
        </div>
        <div className="field">
          <label htmlFor="ob-label">Label (optional)</label>
          <input
            id="ob-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Chennai"
          />
        </div>
      </div>
      {msg && (
        <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
      )}
      <div className="onboard-actions">
        <button type="button" className="btn act" disabled={busy} onClick={save}>
          Save location →
        </button>
      </div>
    </>
  );
}

/** Step 3 — choose RAM to contribute; shows the real hosting capacity it buys; PUT /node/limits. */
function RamStep({ onDone, canHost }: { onDone: () => void; canHost: boolean }) {
  const [gb, setGb] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Your contributed RAM is a real ceiling: capacity = floor(RAM / ~256 MB per agent). Mirrors the
  // node's ramMbPerAgent default so the number shown here matches what the node will actually enforce.
  const agents = Math.floor((gb * 1024) / RAM_MB_PER_AGENT);

  async function start() {
    // On the main node (canHost = false, e.g. the website) you don't run a node here — allocating RAM
    // is done on your OWN node via the desktop app, and the endpoint is admin-gated anyway. So we keep
    // the step as an informational capacity preview and just advance; no allocation call is made.
    if (!canHost) {
      onDone();
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.nodeLimits({ contribute: true, maxRamMb: Math.round(gb * 1024) });
      onDone();
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <p className="muted" style={{ margin: '0 0 12px' }}>
        {canHost
          ? 'Choose how much RAM your node lends — this sets how many agents you can host. More RAM, more capacity.'
          : 'See the hosting capacity your RAM would buy. To actually contribute RAM and host, run a node with the desktop app — you can’t host on the main node.'}
      </p>
      <div className="onboard-ram-presets">
        {RAM_PRESETS.map((v) => (
          <button
            key={v}
            type="button"
            className={`btn ${gb === v ? 'act' : 'ghost'}`}
            onClick={() => setGb(v)}
          >
            {v} GB
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="ob-ram">RAM to contribute (GB)</label>
        <input
          id="ob-ram"
          type="number"
          min={1}
          step={1}
          value={gb}
          onChange={(e) => setGb(Math.max(1, Math.round(Number(e.target.value) || 1)))}
        />
      </div>
      <div className="onboard-earn">
        <div className="onboard-earn-big">
          {agents} <span className="muted">{agents === 1 ? 'agent' : 'agents'}</span>
        </div>
        <div className="muted">hosting capacity at ~{RAM_MB_PER_AGENT} MB / agent</div>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          You earn hosting fees when agent owners run their agents on your node — the more capacity
          you contribute, the more you can host. (Marketplace pricing coming soon.)
        </p>
      </div>
      {err && <div className="note note-err">{err}</div>}
      <div className="onboard-actions">
        <button type="button" className="btn act" disabled={busy} onClick={start}>
          {busy ? 'Saving…' : canHost ? 'Start contributing →' : 'Continue →'}
        </button>
      </div>
    </>
  );
}

/** Final step — surface the account's API token so the operator saves it (reveal / copy / download
 *  as Your_Key.txt). It's the one secret they must keep; anyone with it controls the account. */
function TokenStep({ address, onDone }: { address: string; onDone: () => void }) {
  const token = getWeb3Token();
  const addr = address || localStorage.getItem('web3.creatorName') || '';
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(token).then(
      () => {
        setCopied(true);
        setSaved(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => undefined,
    );
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(addr).then(
      () => {
        setAddrCopied(true);
        setTimeout(() => setAddrCopied(false), 1800);
      },
      () => undefined,
    );
  };

  const download = () => {
    const key = addr ? loadAccountKey(addr) : null;
    const body = [
      'Web3.0 — account backup',
      'KEEP THIS FILE SECRET. Anyone with it can control your account.',
      '',
      `Address:            ${addr}`,
      `API token:          ${token}`,
      '',
      'Signing keypair (ML-DSA, base64url) — lets you send USDC from another device:',
      `  public key:       ${key?.publicKey ?? '(not found on this device)'}`,
      `  secret key:       ${key?.secretKey ?? '(not found on this device)'}`,
      '',
      'How to use:',
      '  - Sign in elsewhere: paste the API token (sent as the x-web3-token header).',
      '  - Restore payments on a new device: import the signing keypair above.',
      '  - Never share the secret key or token.',
      '',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Your_Key.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  return (
    <>
      <p className="muted" style={{ margin: '0 0 12px' }}>
        Save your token now — it's how you sign in on another device or authenticate agent scripts.
        This is the only place it's shown.
      </p>
      {addr && (
        <>
          <div className="section-title">Your address</div>
          <div className="term" style={{ marginBottom: 10 }}>
            <div className="term-body">
              <div className="term-cmd">
                <code>{addr}</code>
                <button
                  type="button"
                  className={`copy ${addrCopied ? 'copied' : ''}`}
                  onClick={copyAddress}
                >
                  {addrCopied ? 'copied ✓' : 'Copy address'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      <div className="section-title">Your token</div>
      <div className="term" style={{ marginBottom: 8 }}>
        <div className="term-body">
          <div className="term-cmd">
            <code>{revealed ? token : `web3_${'•'.repeat(28)}`}</code>
            <button type="button" className="copy" onClick={() => setRevealed((r) => !r)}>
              {revealed ? 'Hide' : 'Reveal'}
            </button>
            <button type="button" className={`copy ${copied ? 'copied' : ''}`} onClick={copy}>
              {copied ? 'copied ✓' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
      <p className="hint">
        Your API token. Copy it to sign in on another device, or use it as the{' '}
        <code>x-web3-token</code> header in agent scripts. Store it like a password.
      </p>
      <div className="onboard-actions">
        <button type="button" className="btn act" onClick={download}>
          ⬇ Download Your_Key.txt
        </button>
        <button type="button" className={`btn ${saved ? 'act' : 'ghost'}`} onClick={onDone}>
          I've saved it — enter dashboard →
        </button>
      </div>
    </>
  );
}

type Persona = 'operator' | 'agent-owner';

/**
 * QuickStartFlow — the "launch a paid agent in 2 minutes" express lane (Phase E). One field → it
 * creates an agent-owner identity, launches a pre-filled paid agent (the `ask` skill at $0.05/call),
 * fires ONE sandbox x402 payment at it so you watch the money land, then hands you the agent's public
 * pay-per-call endpoint. The slower, step-by-step manual onboarding stays available underneath.
 *
 * Only offered where the node can actually host (`canHost`) — a fresh owner on the reserved main node
 * can't launch there, so they take the normal path and run their own node.
 */
function QuickStartFlow({
  onAuthChanged,
  onDone,
  onBack,
}: {
  onAuthChanged: () => Promise<void>;
  onDone: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState('assistant');
  const [phase, setPhase] = useState<'form' | 'launching' | 'done'>('form');
  const [addr, setAddr] = useState('');
  const [agentId, setAgentId] = useState('');
  const [proof, setProof] = useState<X402SelfTest | null>(null);
  const [faucetUrl, setFaucetUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const endpoint = agentId ? `${NODE_URL}/x402/call/${agentId}/ask` : '';

  async function launch() {
    const handle =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') || 'assistant';
    setErr('');
    setPhase('launching');
    try {
      // 1. Identity + wallet (agent-owner), signed in.
      const key = generateAccountKey();
      const acct = await api.signup(handle, 'agent-owner', key.publicKey);
      saveAccountKey(acct.address, key);
      setWeb3Token(acct.token);
      setAddr(acct.address);
      await onAuthChanged();
      // 2. Launch a pre-filled paid agent — the `ask` skill at $0.05/call (price is minor units = cents).
      const agent = await api.hostedLaunch({
        handle: `${handle}bot`,
        name: 'Assistant',
        description: 'A helpful paid agent — answers questions, per call, over x402.',
        skillId: 'ask',
        skillName: 'Ask',
        skillDesc: 'Answer a question',
        price: 5,
        provider: 'tunnel',
        model: '',
        system:
          "You are a helpful assistant. Answer directly and concisely. If you're unsure, say so.",
        createdBy: acct.address,
      });
      setAgentId(agent.web3Id);
      // 3. Instant proof — fire one sandbox payment so they see it earn; grab the faucet link too.
      const [pf, info] = await Promise.all([
        api.x402SelfTest(agent.web3Id, 'ask').catch(() => null),
        api.x402Info().catch(() => null),
      ]);
      setProof(pf);
      setFaucetUrl(info?.faucetUrl ?? null);
      setPhase('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase('form');
    }
  }

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the field is selectable */
    }
  }

  if (phase === 'done') {
    return (
      <div className="onboard">
        <div className="onboard-inner">
          <div className="brand" style={{ justifyContent: 'center', marginBottom: 6 }}>
            <span className="badge">W</span> Web3.0
          </div>
          <h1 className="onboard-title">🎉 Your agent is live</h1>
          {proof ? (
            <p className="muted onboard-sub">
              <b>{agentId}</b> just earned its first <b>${proof.priceUsd}</b> — a real x402 payment
              settled on the ledger (sandbox).
            </p>
          ) : (
            <p className="muted onboard-sub">
              <b>{agentId}</b> is live and priced. It earns each time someone calls it.
            </p>
          )}

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="section-title">Its pay-per-call endpoint</div>
            <p className="muted" style={{ margin: '2px 0 8px' }}>
              Anyone can pay this in USDC via x402 — no signup, no API keys.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                readOnly
                value={endpoint}
                style={{ flex: 1, fontFamily: 'var(--mono, monospace)' }}
              />
              <button type="button" className="btn" onClick={copyEndpoint}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            {faucetUrl && (
              <p className="hint" style={{ marginTop: 10 }}>
                To take <b>real</b> payments on testnet, fund a wallet with{' '}
                <a href={faucetUrl} target="_blank" rel="noreferrer noopener">
                  test USDC ↗
                </a>
                .
              </p>
            )}
          </div>

          <TokenStep address={addr} onDone={onDone} />

          <div className="onboard-actions">
            <button type="button" className="btn act" onClick={onDone}>
              Go to my dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard">
      <div className="onboard-inner">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 6 }}>
          <span className="badge">W</span> Web3.0
        </div>
        <h1 className="onboard-title">Launch a paid agent</h1>
        <p className="muted onboard-sub">
          One tap. We create your identity, launch a working agent priced at $0.05 per call, and
          fire a test payment so you see it earn — then hand you its public endpoint.
        </p>

        <div className="card">
          <label htmlFor="qs-name" className="field-lbl">
            Name your agent
          </label>
          <input
            id="qs-name"
            // biome-ignore lint/a11y/noAutofocus: single-field express flow
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="assistant"
            disabled={phase === 'launching'}
          />
          <div className="gen-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn act"
              onClick={launch}
              disabled={phase === 'launching' || !name.trim()}
            >
              {phase === 'launching' ? 'Launching…' : 'Launch my paid agent 🚀'}
            </button>
          </div>
          {err && <div className="note note-err">{err}</div>}
        </div>

        <div className="onboard-actions">
          <button type="button" className="btn ghost" onClick={onBack}>
            ← More options
          </button>
        </div>
      </div>
    </div>
  );
}

// Persona marks — line icons matching the console (currentColor). Replaces the emoji.
const AgentMark = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="8" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="1.7" />
    <path
      d="M12 5v3M3.5 12.5v3M20.5 12.5v3"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
    <circle cx="12" cy="4" r="1.2" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="9.6" cy="13.2" r="1.15" fill="currentColor" />
    <circle cx="14.4" cy="13.2" r="1.15" fill="currentColor" />
  </svg>
);
const NodeMark = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="16" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
    <rect x="4" y="13" width="16" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="7.6" cy="7.5" r="1" fill="currentColor" />
    <circle cx="7.6" cy="16.5" r="1" fill="currentColor" />
  </svg>
);
const BoltMark = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M13 2 4.5 13.5H10l-1 8.5L19.5 10H13l0-8Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  </svg>
);

/** Step 0 — the fork. Pick the account's persona: own an agent (pay a host to run it) or run a node
 *  (contribute RAM, host other people's agents, earn). The two are mutually exclusive at signup. */
function PersonaStep({
  onPick,
  onExpress,
  onSignInInstead,
}: {
  onPick: (p: Persona) => void;
  /** Start the "launch a paid agent in 2 minutes" express lane. Omitted where the node can't host. */
  onExpress?: () => void;
  onSignInInstead: () => void;
}) {
  return (
    <>
      {onExpress && (
        <button
          type="button"
          className="onboard-persona"
          onClick={onExpress}
          style={{ width: '100%', marginBottom: 14, borderColor: 'var(--accent, currentColor)' }}
        >
          <span className="onboard-persona-emoji">
            <BoltMark />
          </span>
          <b>Launch a paid agent in 2 minutes</b>
          <span className="muted">
            The fast path: we create everything and fire a test payment so you watch it earn.
          </span>
        </button>
      )}
      <p className="muted" style={{ margin: '0 0 14px' }}>
        Or set it up step by step. How do you want to use the network? You can make the other kind
        of account later — an account is one or the other.
      </p>
      <div className="onboard-personas">
        <button type="button" className="onboard-persona" onClick={() => onPick('agent-owner')}>
          <span className="onboard-persona-emoji">
            <AgentMark />
          </span>
          <b>Own an agent</b>
          <span className="muted">
            Create AI agents and pay a host to keep them online. No node to run.
          </span>
        </button>
        <button type="button" className="onboard-persona" onClick={() => onPick('operator')}>
          <span className="onboard-persona-emoji">
            <NodeMark />
          </span>
          <b>Run a node &amp; earn</b>
          <span className="muted">
            Contribute your device's RAM to host other people's agents and earn USDC.
          </span>
        </button>
      </div>
      <p className="hint" style={{ margin: '10px 0 0', textAlign: 'center' }}>
        🧠 <b>Autonomous agent-owners</b> — agents that own and pay for other agents — coming soon.
      </p>
      <div className="onboard-actions">
        <button type="button" className="btn ghost" onClick={onSignInInstead}>
          I already have an account
        </button>
      </div>
    </>
  );
}

export function Onboarding({
  authed,
  canHost,
  onAuthChanged,
  onDone,
  onSignInInstead,
}: {
  authed: boolean;
  /** Whether this node can actually host agents (own node / desktop). False on the admin-only main
   *  node (the website), where the RAM step becomes an informational earnings preview. */
  canHost: boolean;
  /** Re-check auth in the parent after signup so the token/account propagate. */
  onAuthChanged: () => Promise<void>;
  /** All steps finished — mark onboarded and enter the dashboard. */
  onDone: () => void;
  /** Returning user wants to sign in with an existing token instead. */
  onSignInInstead: () => void;
}) {
  // null = still on the fork step (persona not yet chosen). A returning signed-in user gets their
  // persona from their account role at mount, so they skip the fork.
  const [persona, setPersona] = useState<Persona | null>(null);
  // The express "launch a paid agent in 2 minutes" lane (Phase E). Only offered where the node can
  // host; the manual persona flow below is always available.
  const [express, setExpress] = useState(false);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [addr, setAddr] = useState('');
  const [locLabel, setLocLabel] = useState('');
  // Keep the latest onDone without making the probe effect depend on it (the parent passes a fresh
  // closure each render, which would otherwise re-run the probe and reset the wizard step).
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Probe ONCE at mount. If the visitor is already signed in when the wizard opens (a returning user,
  // or one who created their account on the Landing page), adopt their persona from their account role
  // and resume at the first incomplete step. A brand-new visitor (not signed in at mount) starts on
  // the persona fork; the probe does not re-run when they sign in mid-wizard, so a node that already
  // has RAM/location from earlier testing can't make a fresh operator signup skip location or RAM.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally runs once, using mount-time auth
  useEffect(() => {
    let active = true;
    (async () => {
      let s = 0;
      let p: Persona | null = null;
      if (authed) {
        try {
          const me = await api.me();
          setAddr(me.address);
          p = me.role === 'agent-owner' ? 'agent-owner' : 'operator';
          // Identity is already done; resume past it. For an operator, walk the node-setup steps
          // (location → RAM); an agent-owner has none, so jump straight to "Save your key". A fully
          // set-up operator (has location + RAM) lands on the final "Save your key" step (step 3)
          // rather than being silently dropped into the dashboard.
          s = 1;
          if (p === 'operator') {
            const [locs, node] = await Promise.all([api.nodeLocations(), api.node()]);
            const loc = locs.locations.find((l) => l.address === me.address);
            if (loc) {
              s = 2;
              setLocLabel(loc.label || 'your location');
            }
            if (loc && node.limits.maxRamMb > 0) s = 3;
          }
        } catch {
          /* fall back to the earliest incomplete step */
        }
      }
      if (!active) return;
      setPersona(p);
      setStep(s);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!ready) return <div className="landing" aria-busy="true" />;

  const state = (i: number): StepState => (i < step ? 'done' : i === step ? 'active' : 'todo');

  // The express "launch a paid agent in 2 minutes" lane.
  if (express) {
    return (
      <QuickStartFlow
        onAuthChanged={onAuthChanged}
        onDone={onDone}
        onBack={() => setExpress(false)}
      />
    );
  }

  // Fork not yet chosen — show the persona picker (with the express lane on top where we can host).
  if (persona === null) {
    return (
      <div className="onboard">
        <div className="onboard-inner">
          <div className="brand" style={{ justifyContent: 'center', marginBottom: 6 }}>
            <span className="badge">W</span> Web3.0
          </div>
          <h1 className="onboard-title">Welcome to Web3.0</h1>
          <p className="muted onboard-sub">Choose how you'll join the network.</p>
          <PersonaStep
            onPick={setPersona}
            onExpress={canHost ? () => setExpress(true) : undefined}
            onSignInInstead={onSignInInstead}
          />
        </div>
      </div>
    );
  }

  // Agent-owner: a short two-step flow — create your identity + wallet, then save your key. You create
  // and manage agents from the dashboard (Genesis); hosting is the operator's job, not yours.
  if (persona === 'agent-owner') {
    return (
      <div className="onboard">
        <div className="onboard-inner">
          <div className="brand" style={{ justifyContent: 'center', marginBottom: 6 }}>
            <span className="badge">W</span> Web3.0
          </div>
          <h1 className="onboard-title">Own an agent — quick setup</h1>
          <p className="muted onboard-sub">
            Create your identity and wallet, then start building agents.
          </p>

          <ProgressBar done={step} total={2} />

          <StepCard n={1} title="Create your identity" state={state(0)} summary={addr}>
            <NameStep
              persona="agent-owner"
              onDone={async (address) => {
                setAddr(address);
                await onAuthChanged();
                setStep(1);
              }}
              onSignInInstead={onSignInInstead}
            />
          </StepCard>

          <StepCard n={2} title="Save your key" state={state(1)}>
            <TokenStep address={addr} onDone={onDone} />
          </StepCard>
        </div>
      </div>
    );
  }

  // Operator: the full node-operator setup — identity → put your node on the map → contribute RAM →
  // save your key.
  return (
    <div className="onboard">
      <div className="onboard-inner">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 6 }}>
          <span className="badge">W</span> Web3.0
        </div>
        <h1 className="onboard-title">Run a node — quick setup</h1>
        <p className="muted onboard-sub">A few quick steps and you're earning on the network.</p>

        <ProgressBar done={step} total={4} />

        <StepCard n={1} title="Create your identity" state={state(0)} summary={addr}>
          <NameStep
            persona="operator"
            onDone={async (address) => {
              setAddr(address);
              await onAuthChanged();
              setStep(1);
            }}
            onSignInInstead={onSignInInstead}
          />
        </StepCard>

        <StepCard n={2} title="Put your node on the map" state={state(1)} summary={locLabel}>
          <LocationStep
            onDone={(label) => {
              setLocLabel(label);
              setStep(2);
            }}
          />
        </StepCard>

        <StepCard n={3} title="Contribute RAM & start earning" state={state(2)}>
          <RamStep canHost={canHost} onDone={() => setStep(3)} />
        </StepCard>

        <StepCard n={4} title="Save your key" state={state(3)}>
          <TokenStep address={addr} onDone={onDone} />
        </StepCard>
      </div>
    </div>
  );
}
