import { useCallback, useEffect, useState } from 'react';
import {
  type Account as Acct,
  type Role,
  api,
  formatAmount,
  getWeb3Token,
  setWeb3Token,
} from './api.js';

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
      const res = await api.signup(local.trim(), role);
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
    } catch {
      setWeb3Token('');
      setMsg({ kind: 'err', text: 'That token is not valid on this node.' });
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
            <dt>Since</dt>
            <dd>{new Date(me.createdAt).toLocaleString()}</dd>
          </dl>

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
