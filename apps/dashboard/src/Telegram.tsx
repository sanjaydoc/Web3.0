import { useCallback, useEffect, useState } from 'react';
import { type TelegramStatus, api } from './api.js';

const ADMIN_KEY = 'web3.adminToken';

export function Telegram() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [admin, setAdmin] = useState(() => localStorage.getItem(ADMIN_KEY) ?? '');
  const [token, setToken] = useState('');
  const [botLocal, setBotLocal] = useState('telegrambot');
  const [skill, setSkill] = useState('ask');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.telegram();
      setStatus(s);
      setBotLocal(s.botLocal);
      setSkill(s.skill);
    } catch (err) {
      setMsg({ kind: 'err', text: `couldn't reach node: ${String(err)}` });
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const rememberAdmin = (value: string) => {
    setAdmin(value);
    localStorage.setItem(ADMIN_KEY, value);
  };

  const run = async (fn: () => Promise<TelegramStatus>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      setStatus(await fn());
      setToken('');
      setMsg({ kind: 'ok', text: ok });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const save = (enabled: boolean) =>
    run(
      () => api.telegramConfig({ enabled, token: token || undefined, botLocal, skill }, admin),
      enabled ? 'Saved — bot starting.' : 'Saved.',
    );

  return (
    <>
      <div className="page-head">
        <h1>Telegram bot</h1>
        <span className="muted">a human front door to your agents — configured here, no files</span>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Configure</span>
          {status && (
            <span className={`chip ${status.running ? 'allow' : 'deny'}`}>
              {status.running ? 'running' : 'stopped'}
            </span>
          )}
        </div>

        {status?.adminRequired && (
          <div className="field wide">
            <label htmlFor="admin">Admin token</label>
            <input
              id="admin"
              type="password"
              value={admin}
              onChange={(e) => rememberAdmin(e.target.value)}
              placeholder="required to change settings"
            />
            <span className="hint">
              Set by the operator via WEB3_ADMIN_TOKEN · stored in this browser only
            </span>
          </div>
        )}

        <div className="field wide">
          <label htmlFor="token">Bot token</label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              status?.tokenSet ? `saved (${status.tokenHint})` : 'paste your @BotFather token'
            }
          />
          <span className="hint">
            Stored server-side, never shown again · leave blank to keep the saved one
          </span>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="botlocal">Bridge handle</label>
            <input id="botlocal" value={botLocal} onChange={(e) => setBotLocal(e.target.value)} />
            <span className="hint">its Web3.0 ID + wallet</span>
          </div>
          <div className="field">
            <label htmlFor="skill">Ask skill</label>
            <input id="skill" value={skill} onChange={(e) => setSkill(e.target.value)} />
            <span className="hint">skill id used by /ask</span>
          </div>
        </div>

        <div className="gen-actions">
          <button type="button" className="btn act" disabled={busy} onClick={() => save(true)}>
            Save &amp; start
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => save(false)}>
            Save &amp; stop
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => run(() => api.telegramStop(admin), 'Stopped.')}
          >
            Stop bot
          </button>
        </div>
        {msg && (
          <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
        )}
      </div>

      {status && (
        <div className="card">
          <div className="section-title">Status</div>
          <dl className="kv">
            <dt>Bot</dt>
            <dd>
              {status.botUsername
                ? `@${status.botUsername}`
                : status.tokenSet
                  ? 'token saved'
                  : 'not configured'}
            </dd>
            <dt>Bridge agent</dt>
            <dd className="mono-hash">{status.bridgeId}</dd>
            <dt>State</dt>
            <dd>
              {status.running ? 'running' : status.enabled ? 'enabled (stopped)' : 'disabled'}
            </dd>
            {status.lastError && (
              <>
                <dt>Last error</dt>
                <dd style={{ color: 'var(--no)' }}>{status.lastError}</dd>
              </>
            )}
          </dl>
          <p className="hint">
            Commands: <code>/help</code> · <code>/agents</code> · <code>/whoami</code> ·{' '}
            <code>/ask &lt;agent&gt; &lt;question&gt;</code>
          </p>
        </div>
      )}
    </>
  );
}
