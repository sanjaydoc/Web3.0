import { useCallback, useEffect, useState } from 'react';
import { type Lease, type MarketHost, api, formatAmount } from './api.js';

/**
 * Marketplace — the agent-owner side of the compute marketplace. Browse hosts selling RAM capacity,
 * rent one to run an agent (creating a lease billed each epoch), and manage your active rentals. The
 * host earns the fee minus the platform commission; you pay from your wallet.
 */
export function Marketplace() {
  const [hosts, setHosts] = useState<MarketHost[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [agentId, setAgentId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([api.hostingMarket(), api.hostingLeases()]);
      setHosts(m.hosts);
      setLeases(l.leases);
    } catch {
      /* node offline — keep last */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const rent = async () => {
    const id = agentId.trim();
    if (!id) {
      setMsg({ kind: 'err', text: 'Enter the agent you want hosted (e.g. myagent@web3.0).' });
      return;
    }
    setBusy('rent');
    setMsg(null);
    try {
      await api.rentHost(id);
      setAgentId('');
      setMsg({ kind: 'ok', text: `Rented hosting for ${id}. You'll be billed each epoch.` });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const end = async (id: string) => {
    setBusy(id);
    try {
      await api.endLease(id);
      await load();
    } catch {
      /* keep */
    } finally {
      setBusy(null);
    }
  };

  const mine = leases.filter((l) => l.active);

  return (
    <>
      <div className="page-head">
        <h1>Marketplace</h1>
        <span className="muted">rent RAM to run your agents</span>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="section-title">Rent hosting for an agent</div>
        <div className="field" style={{ maxWidth: 360 }}>
          <label htmlFor="mkt-agent">Agent to host</label>
          <input
            id="mkt-agent"
            value={agentId}
            placeholder="myagent@web3.0"
            onChange={(e) => setAgentId(e.target.value)}
          />
        </div>
        {msg && (
          <div className={`note ${msg.kind === 'err' ? 'note-err' : 'note-ok'}`}>{msg.text}</div>
        )}
        {hosts.length === 0 ? (
          <div className="empty">No hosts are offering capacity yet.</div>
        ) : (
          <div className="hscroll">
            <table>
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Price / epoch</th>
                  <th>Free capacity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hosts.map((h) => (
                  <tr key={h.host}>
                    <td>
                      <strong>{h.host}</strong>
                    </td>
                    <td>{formatAmount(h.pricePerEpoch)}</td>
                    <td>
                      {h.free} / {h.capacity || '∞'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn act"
                        disabled={busy === 'rent' || h.free === 0}
                        onClick={rent}
                      >
                        {busy === 'rent' ? '…' : 'Rent'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Your rentals</div>
        {mine.length === 0 ? (
          <div className="empty">You're not renting any hosting yet.</div>
        ) : (
          <div className="hscroll">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Host</th>
                  <th>Price / epoch</th>
                  <th>Epochs</th>
                  <th>Paid</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mine.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.agentId}</strong>
                    </td>
                    <td>{l.host}</td>
                    <td>{formatAmount(l.pricePerEpoch)}</td>
                    <td>{l.epochsBilled}</td>
                    <td>{formatAmount(l.paidTotal)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={busy === l.id}
                        onClick={() => end(l.id)}
                      >
                        {busy === l.id ? '…' : 'End'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
