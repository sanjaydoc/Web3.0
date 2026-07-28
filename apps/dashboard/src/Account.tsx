import { useCallback, useEffect, useState } from 'react';
import {
  type Account as Acct,
  ApiError,
  NODE_URL,
  type Role,
  api,
  formatAmount,
  getWeb3Token,
  setWeb3Token,
} from './api.js';

/**
 * Turn a sign-in failure into an honest, actionable message. The three cases used to collapse into
 * one misleading "not valid on this node"; now we separate them so the user knows whether to fix
 * their token, or that the node/CORS is the problem.
 */
function signinError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0)
      return `Couldn't reach the node at ${NODE_URL} — it may be offline, or this site's origin isn't allowed (CORS).`;
    if (err.status === 401)
      return 'Token not recognized by this node. Check for a missing character or an extra space, and make sure this token belongs to this node.';
    return `Sign-in failed (${err.status}).`;
  }
  return 'Sign-in failed. Check the browser console for details.';
}
import {
  type AccountKey,
  generateAccountKey,
  loadAccountKey,
  saveAccountKey,
  signTransfer,
} from './txsign.js';

/**
 * PaymentsSection — trustless "Send aETH". If the account has a signing key here AND it's bound
 * on-chain, it shows a send form: the transfer is signed on this device with the account's ML-DSA
 * key and submitted to the network (POST /tx), where an authority verifies ownership + balance and
 * seals it. Otherwise it offers to enable payments (generate a key + bind its public half).
 */
function PaymentsSection({
  me,
  bound,
  onchainKey,
  onChanged,
}: { me: Acct; bound: boolean; onchainKey: string | null; onChanged: () => void }) {
  const [localKey, setLocalKey] = useState<AccountKey | null>(() => loadAccountKey(me.address));
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function enable() {
    setBusy(true);
    setNote(null);
    try {
      const key = localKey ?? generateAccountKey();
      await api.bindKey(key.publicKey);
      saveAccountKey(me.address, key);
      setLocalKey(key);
      setNote({ kind: 'ok', text: 'Payments enabled — your signing key is bound on-chain.' });
      onChanged();
    } catch (err) {
      setNote({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function sendPayment() {
    if (!localKey) return;
    const minor = Math.round(Number.parseFloat(amount) * 100);
    if (!to.trim() || !Number.isFinite(minor) || minor <= 0) {
      setNote({ kind: 'err', text: 'Enter a valid recipient and amount.' });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const { nonce } = await api.txNonce(me.address);
      const tx = signTransfer(localKey, {
        from: me.address,
        to: to.trim(),
        amount: minor,
        nonce,
        memo: memo.trim() || undefined,
      });
      await api.submitTx(tx);
      setNote({ kind: 'ok', text: `Sent ${(minor / 100).toFixed(2)} aETH to ${to.trim()}.` });
      setTo('');
      setAmount('');
      setMemo('');
      onChanged();
    } catch (err) {
      setNote({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  // A proven key mismatch: we KNOW the on-chain key (server returned it) and this device's key is a
  // different one — the network would reject the tx ("signature key does not match the account
  // on-chain"). Only block on a *proven* mismatch so an older node that doesn't report the key yet
  // still behaves as before (no false lock-out).
  const mismatch = !!localKey && !!onchainKey && localKey.publicKey !== onchainKey;
  const ready = !!localKey && bound && !mismatch;

  return (
    <>
      <div className="section-title" style={{ marginTop: 18 }}>
        Send aETH
      </div>
      {ready ? (
        <>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="p-to">To</label>
              <input
                id="p-to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="karthik@web3.0"
              />
            </div>
            <div className="field">
              <label htmlFor="p-amt">Amount (aETH)</label>
              <input
                id="p-amt"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="10.00"
                inputMode="decimal"
              />
            </div>
          </div>
          <div className="field wide">
            <label htmlFor="p-memo">Memo (optional)</label>
            <input
              id="p-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="for the compute"
            />
          </div>
          <div className="gen-actions">
            <button type="button" className="btn act" disabled={busy} onClick={sendPayment}>
              {busy ? 'Signing…' : 'Sign & send'}
            </button>
          </div>
          <p className="hint">
            Signed on this device with your account key (ML-DSA) and submitted to the network. An
            authority verifies your signature, checks your balance, and seals it into a block — so a
            peer can carry your payment without being trusted.
          </p>
        </>
      ) : (
        <>
          <p className="hint">
            {mismatch
              ? 'This device’s signing key doesn’t match your account’s key on-chain — that’s why sends are rejected. This happens on a new install or a different device. Re-bind to make THIS device your signing key (it replaces the old one on-chain; other devices then need to re-bind too).'
              : localKey && !bound
                ? 'Your device has a signing key, but it isn’t bound on-chain yet. Bind it to send payments.'
                : bound && !localKey
                  ? 'Your signing key lives on another device. Generate a new one here to send from this browser (it replaces the old key on-chain).'
                  : 'Turn on trustless payments: this generates an ML-DSA key in your browser and binds its public half on-chain. The secret half never leaves this device.'}
          </p>
          <div className="gen-actions">
            <button type="button" className="btn act" disabled={busy} onClick={enable}>
              {busy
                ? mismatch
                  ? 'Re-binding…'
                  : 'Enabling…'
                : mismatch
                  ? 'Re-bind this device’s key'
                  : 'Enable payments'}
            </button>
          </div>
        </>
      )}
      {note && (
        <div
          className={`note ${note.kind === 'err' ? 'note-err' : 'note-ok'}`}
          style={{ marginTop: 10 }}
        >
          {note.text}
        </div>
      )}
    </>
  );
}

/**
 * Account — sign up (mint an address + one-time Web3.0 token) or sign in (paste a token). The token is
 * stored in this browser and sent as `x-web3-token` on every request, so the node scopes what you see
 * and can do by your role. This is the GUI front for the accounts/auth backend.
 */
export function Account() {
  const [me, setMe] = useState<Acct | null>(null);
  const [checked, setChecked] = useState(false);
  const [local, setLocal] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [tokenInput, setTokenInput] = useState('');
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  /** Whether this account's signing key is bound on-chain (can it send trustless payments). */
  const [keyBound, setKeyBound] = useState(false);
  /** The account's on-chain signing key — compared against this device's key to catch a mismatch. */
  const [onchainKey, setOnchainKey] = useState<string | null>(null);

  const copyToken = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => undefined,
    );
  }, []);

  const refresh = useCallback(async () => {
    if (!getWeb3Token()) {
      setMe(null);
      setChecked(true);
      return;
    }
    try {
      const acct = await api.me();
      setMe(acct);
      api
        .wallet(acct.address)
        .then((w) => setBalance(w.wallet.balance))
        .catch(() => setBalance(0));
      api
        .txNonce(acct.address)
        .then((n) => {
          setKeyBound(n.bound);
          setOnchainKey(n.pubkey ?? null); // older nodes omit `pubkey` → treat as unknown
        })
        .catch(() => {
          setKeyBound(false);
          setOnchainKey(null);
        });
    } catch {
      setMe(null); // stale/invalid token
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function signup() {
    setMsg(null);
    setFreshToken(null);
    try {
      // Generate the account's transaction-signing key in the browser and bind its PUBLIC half
      // on-chain at signup; the secret half never leaves this device. This is what lets the
      // account send trustless, owner-signed payments across the shared network.
      const key = generateAccountKey();
      const res = await api.signup(local.trim(), role, key.publicKey);
      saveAccountKey(res.address, key);
      setWeb3Token(res.token);
      setFreshToken(res.token);
      setRevealed(true); // show it immediately in the signed-in view
      // remember the creator name for dApp scoping too
      localStorage.setItem('web3.creatorName', res.address);
      await refresh();
      setMsg({ kind: 'ok', text: `Account created: ${res.address} (${res.role})` });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function signin() {
    setMsg(null);
    setFreshToken(null);
    setWeb3Token(tokenInput.trim());
    try {
      const acct = await api.me();
      setMe(acct);
      localStorage.setItem('web3.creatorName', acct.address);
      setTokenInput('');
      setMsg({ kind: 'ok', text: `Signed in as ${acct.address}` });
    } catch (err) {
      setWeb3Token('');
      setMsg({ kind: 'err', text: signinError(err) });
    }
  }

  function signout() {
    setWeb3Token('');
    setMe(null);
    setFreshToken(null);
    setRevealed(false);
    // Drop back to the landing gate (App re-checks auth on load).
    window.location.reload();
  }

  const token = me ? getWeb3Token() : null;

  return (
    <>
      <div className="page-head">
        <h1>Account</h1>
        <span className="muted">your Web3.0 identity — an address + a token, with a role</span>
      </div>

      {me ? (
        <div className="card">
          <div className="section-title">Signed in</div>
          <dl className="kv">
            <dt>Address</dt>
            <dd className="mono-hash">{me.address}</dd>
            <dt>Wallet</dt>
            <dd>
              <b>{balance === null ? '…' : formatAmount(balance)}</b>{' '}
              <span className="muted">— earn via agents &amp; fees · stake it in My node</span>
            </dd>
            <dt>Role</dt>
            <dd>
              <span className="chip allow">{me.role}</span>
            </dd>
            <dt>Plan</dt>
            <dd>
              <span className={`chip ${me.plan === 'pro' ? 'allow' : ''}`}>
                {me.plan === 'pro' ? 'Pro' : 'Free'}
              </span>{' '}
              {me.plan === 'free' && (
                <span className="muted">
                  — host a few agents free; Pro (buy credits) lifts the limit. Coming soon.
                </span>
              )}
            </dd>
            <dt>Since</dt>
            <dd>{new Date(me.createdAt).toLocaleString()}</dd>
          </dl>

          <PaymentsSection me={me} bound={keyBound} onchainKey={onchainKey} onChanged={refresh} />

          {token && (
            <>
              <div className="section-title" style={{ marginTop: 18 }}>
                Your token
              </div>
              <div className="term" style={{ marginBottom: 8 }}>
                <div className="term-body">
                  <div className="term-cmd">
                    <code>{revealed ? token : `web3_${'•'.repeat(28)}`}</code>
                    <button type="button" className="copy" onClick={() => setRevealed((r) => !r)}>
                      {revealed ? 'Hide' : 'Reveal'}
                    </button>
                    <button
                      type="button"
                      className={`copy ${copied ? 'copied' : ''}`}
                      onClick={() => copyToken(token)}
                    >
                      {copied ? 'copied ✓' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
              <p className="hint">
                {freshToken
                  ? 'New token — copy it now and store it safely. This is the only place it’s shown.'
                  : 'Your API token. Copy it to sign in on another device, or use it as the x-web3-token header in agent scripts. Store it like a password.'}
              </p>
            </>
          )}

          <div className="gen-actions">
            <button type="button" className="btn ghost" onClick={signout}>
              Sign out
            </button>
          </div>
          <p className="hint">
            Your token is sent as <code>x-web3-token</code> on every request — the node scopes
            Hosted dApps and management to your role.
          </p>
        </div>
      ) : (
        <>
          {freshToken && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="section-title">Save your token — shown only once</div>
              <div className="term" style={{ marginBottom: 10 }}>
                <div className="term-body">
                  <div className="term-cmd">
                    <code>{freshToken}</code>
                    <button
                      type="button"
                      className={`copy ${copied ? 'copied' : ''}`}
                      onClick={() => {
                        navigator.clipboard.writeText(freshToken).then(
                          () => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1800);
                          },
                          () => undefined,
                        );
                      }}
                    >
                      {copied ? 'copied ✓' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
              <p className="hint">
                It's saved in this browser now. Keep a copy — it's your API token and it won't be
                shown again.
              </p>
            </div>
          )}

          <div className="grid-2">
            <div className="card">
              <div className="section-title">Sign up</div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="a-local">Handle</label>
                  <input
                    id="a-local"
                    value={local}
                    onChange={(e) => setLocal(e.target.value)}
                    placeholder="sanjay"
                  />
                  <span className="hint">{local || '…'}@web3.0</span>
                </div>
                <div className="field">
                  <label htmlFor="a-role">Role</label>
                  <select
                    id="a-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as Role)}
                  >
                    <option value="operator">node operator</option>
                    <option value="admin">admin</option>
                  </select>
                  <span className="hint">first admin bootstraps free; more need admin</span>
                </div>
              </div>
              <div className="gen-actions">
                <button type="button" className="btn act" disabled={!local.trim()} onClick={signup}>
                  Create account
                </button>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Sign in</div>
              <div className="field wide">
                <label htmlFor="a-token">Web3.0 token</label>
                <input
                  id="a-token"
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="web3_…"
                />
                <span className="hint">paste a token you saved earlier</span>
              </div>
              <div className="gen-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={!tokenInput.trim()}
                  onClick={signin}
                >
                  Sign in
                </button>
              </div>
            </div>
          </div>
          {checked && !me && !freshToken && (
            <p className="hint" style={{ marginTop: 12 }}>
              On an open node (no accounts yet) you can use the dashboard without signing in. Create
              an account to get a real role-scoped identity.
            </p>
          )}
        </>
      )}
      {msg && (
        <div
          className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}
          style={{ marginTop: 14 }}
        >
          {msg.text}
        </div>
      )}
    </>
  );
}
