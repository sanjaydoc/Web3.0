import { useState } from 'react';
import { NODE_URL, getWeb3Token } from './api.js';

/**
 * ConnectMcp — the "Connect via MCP" tab. Shows this node's Oxygen MCP endpoint, a live connection
 * test, the tool/resource/prompt catalog, and copy-paste client configs. The full agent studio +
 * wallet is served over HTTP at POST /mcp; a lean wallet-only variant runs over stdio.
 */
const ENDPOINT = `${NODE_URL}/mcp`;

const TOOLS: { name: string; desc: string }[] = [
  { name: 'create_agent', desc: 'Launch a new agent (ERC-8004 identity + x402 pricing come free)' },
  { name: 'edit_agent', desc: 'Update an agent you own in place' },
  { name: 'test_agent', desc: 'Ask one of your agents a question' },
  { name: 'list_agents', desc: 'List the agents you own' },
  { name: 'add_knowledge', desc: 'Attach a document or link to an agent’s RAG' },
  { name: 'wallet_info', desc: 'Your per-account x402 wallet: address, USDC balance, spent' },
  { name: 'x402_fetch', desc: 'Fetch a URL, auto-paying an HTTP 402 with a signed authorization' },
];

const CLAUDE_HTTP_CONFIG = (endpoint: string, token: string) =>
  `{
  "mcpServers": {
    "oxygen": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${endpoint}", "--header", "x-web3-token:${token}"]
    }
  }
}`;

const CLAUDE_STDIO_CONFIG = `{
  "mcpServers": {
    "oxygen-wallet": { "command": "npx", "args": ["-y", "@web3/oxygen-mcp"] }
  }
}`;

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost btn-sm"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export function ConnectMcp() {
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const token = getWeb3Token();

  async function testConnection() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const body = (await res.json()) as { result?: { tools?: { name: string }[] } };
      const names = body.result?.tools?.map((t) => t.name) ?? [];
      if (names.length)
        setStatus({ kind: 'ok', text: `Connected — ${names.length} tools: ${names.join(', ')}` });
      else
        setStatus({
          kind: 'err',
          text: 'Reached the node, but no tools returned (is the mcp module loaded?)',
        });
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect-mcp">
      <div className="page-head stack">
        <h2 className="section-title">Connect via MCP</h2>
        <p className="muted">
          <strong>Oxygen</strong> is this node’s Model Context Protocol server. Point any MCP client
          (Claude Desktop, Claude Code, another agent) at it to{' '}
          <strong>build & manage agents</strong> and use a <strong>per-account x402 wallet</strong>{' '}
          — one endpoint, JSON-RPC 2.0.
        </p>
      </div>

      <div className="card">
        <h3 className="field-lbl">Endpoint</h3>
        <div className="gchat-endpoint">
          <code>{ENDPOINT}</code>
          <Copy text={ENDPOINT} />
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn act btn-sm" disabled={busy} onClick={testConnection}>
            {busy ? 'Testing…' : 'Test connection'}
          </button>
          {status && <span className={`hint ${status.kind}`}>{status.text}</span>}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Auth: send your Web4.0 account token as the <code>x-web3-token</code> header. Each account
          gets its own isolated wallet. Your token is on the <strong>Account</strong> page.
        </p>
      </div>

      <div className="card">
        <h3 className="field-lbl">Claude Desktop / Code — full server (agents + wallet)</h3>
        <p className="hint">
          Bridges Claude’s local MCP config to this HTTP endpoint via <code>mcp-remote</code>. The
          copy button inserts your token (kept off-screen).
        </p>
        <pre className="mcp-code">{CLAUDE_HTTP_CONFIG(ENDPOINT, '<YOUR_TOKEN>')}</pre>
        <Copy
          text={CLAUDE_HTTP_CONFIG(ENDPOINT, token || '<YOUR_TOKEN>')}
          label={token ? 'Copy with my token' : 'Copy'}
        />
      </div>

      <div className="card">
        <h3 className="field-lbl">Claude Desktop / Code — wallet only (stdio)</h3>
        <p className="hint">A lean variant exposing just the x402 wallet (no node needed).</p>
        <pre className="mcp-code">{CLAUDE_STDIO_CONFIG}</pre>
        <Copy text={CLAUDE_STDIO_CONFIG} />
      </div>

      <div className="card">
        <h3 className="field-lbl">Tools</h3>
        <ul className="mcp-tools">
          {TOOLS.map((t) => (
            <li key={t.name}>
              <code>{t.name}</code>
              <span className="muted"> — {t.desc}</span>
            </li>
          ))}
        </ul>
        <p className="hint" style={{ marginTop: 8 }}>
          <strong>Resources:</strong> <code>web3://agents</code>,{' '}
          <code>web3://agent/&lt;handle&gt;</code>, <code>web3://knowledge/&lt;handle&gt;</code> ·{' '}
          <strong>Prompts:</strong> create-agent, edit-agent, test-agent, agent-faq.
        </p>
      </div>

      <div className="card">
        <h3 className="field-lbl">Or just curl it</h3>
        <pre className="mcp-code">{`curl -s ${ENDPOINT} -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_agent",
       "arguments":{"name":"Coffee Concierge","description":"answers FAQs","provider":"tunnel","priceUsd":0}}}'`}</pre>
        <Copy
          text={`curl -s ${ENDPOINT} -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
          label="Copy tools/list curl"
        />
      </div>
    </div>
  );
}
