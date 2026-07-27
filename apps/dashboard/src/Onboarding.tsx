import { useEffect, useRef, useState } from 'react';
import { api, formatAmount, getWeb3Token, setWeb3Token } from './api.js';
import { generateAccountKey, loadAccountKey, saveAccountKey } from './txsign.js';

/**
 * First-run onboarding for a brand-new node operator, shown once on their OWN node (never on the
 * reserved main node). Three required steps — pick a name, drop your node on the map, choose how much
 * RAM to lend — then land on the dashboard. Each step reuses the SAME API the dashboard uses
 * (`api.signup` / `api.setNodeLocation` / `api.nodeLimits`), so there's one source of truth and the
 * existing views are untouched. Progress is shown as green-filling step cards.
 */

// A friendly, clearly-labelled earnings estimate: what you earn scales with the RAM you lend. The
// real payout is score-based and depends on live network activity + the reward pool — so this is an
// estimate to set expectations, not a promise.
const EST_AETH_PER_GB_DAY = 2;
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

/** Step 1 — pick a handle; creates the account (name@web3.0) + signing key and signs in. */
function NameStep({
  onDone,
  onSignInInstead,
}: {
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
      const res = await api.signup(handle, 'operator', key.publicKey);
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

/** Step 3 — choose RAM to contribute; shows a friendly earnings estimate; PUT /node/limits. */
function RamStep({ onDone }: { onDone: () => void }) {
  const [gb, setGb] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const perDay = gb * EST_AETH_PER_GB_DAY;

  async function start() {
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
        Choose how much RAM your node lends to the network — more resources, more rewards.
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
          ~{formatAmount(perDay * 100)} <span className="muted">/ day</span>
        </div>
        <div className="muted">≈ {formatAmount(perDay * 100 * 30)} / month · estimated</div>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          Estimate only — actual rewards are shared each epoch across all live nodes by
          contribution, and depend on network activity and the reward pool.
        </p>
      </div>
      {err && <div className="note note-err">{err}</div>}
      <div className="onboard-actions">
        <button type="button" className="btn act" disabled={busy} onClick={start}>
          {busy ? 'Saving…' : 'Start contributing →'}
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
      'Signing keypair (ML-DSA, base64url) — lets you send aETH from another device:',
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

export function Onboarding({
  authed,
  onAuthChanged,
  onDone,
  onSignInInstead,
}: {
  authed: boolean;
  /** Re-check auth in the parent after signup so the token/account propagate. */
  onAuthChanged: () => Promise<void>;
  /** All three steps finished — mark onboarded and enter the dashboard. */
  onDone: () => void;
  /** Returning user wants to sign in with an existing token instead. */
  onSignInInstead: () => void;
}) {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [addr, setAddr] = useState('');
  const [locLabel, setLocLabel] = useState('');
  // Keep the latest onDone without making the probe effect depend on it (the parent passes a fresh
  // closure each render, which would otherwise re-run the probe and reset the wizard step).
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Probe what's already done so a partially-set-up user resumes at the right step (and a fully
  // set-up one skips straight to the dashboard). Brand-new users (no token) start at step 0.
  useEffect(() => {
    let active = true;
    (async () => {
      let s = 0;
      if (authed) {
        s = 1;
        try {
          const [me, locs, node] = await Promise.all([api.me(), api.nodeLocations(), api.node()]);
          setAddr(me.address);
          const loc = locs.locations.find((l) => l.address === me.address);
          if (loc) {
            s = 2;
            setLocLabel(loc.label || 'your location');
          }
          if (loc && node.limits.maxRamMb > 0) {
            if (active) onDoneRef.current();
            return;
          }
        } catch {
          /* fall back to the earliest incomplete step */
        }
      }
      if (!active) return;
      setStep(s);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [authed]);

  if (!ready) return <div className="landing" aria-busy="true" />;

  const state = (i: number): StepState => (i < step ? 'done' : i === step ? 'active' : 'todo');

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
          <RamStep onDone={() => setStep(3)} />
        </StepCard>

        <StepCard n={4} title="Save your key" state={state(3)}>
          <TokenStep address={addr} onDone={onDone} />
        </StepCard>
      </div>
    </div>
  );
}
