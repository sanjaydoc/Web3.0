import { useEffect, useState } from 'react';
import { type KnowledgeHit, type KnowledgeSource, api, fileToBase64 } from './api.js';

// Text-like files we read client-side and post as text; PDF/Word are sent as base64 bytes and the
// node extracts their text (see docparse on the server).
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|html?|xml|yaml|yml|rtf)$/i;
const DOC_EXT = /\.(pdf|docx|xlsx)$/i;

/**
 * KnowledgePanel — attach a RAG knowledge base to one agent (Genesis chat Phase 2). The owner pastes
 * text, uploads text-like files, or adds links; each source is chunked + embedded on the node and the
 * agent answers from them (with citations). A query box previews what the agent would retrieve.
 */
export function KnowledgePanel({ web3Id, title }: { web3Id: string; title: string }) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [embedder, setEmbedder] = useState<string | undefined>();
  const [tab, setTab] = useState<'text' | 'link' | 'file'>('text');
  const [textTitle, setTextTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [testQ, setTestQ] = useState('');
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);

  const refresh = () => {
    api
      .knowledgeSources(web3Id)
      .then((r) => {
        setSources(r.sources);
        setEmbedder(r.embedder);
      })
      .catch(() => {});
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh when the target agent changes
  useEffect(refresh, [web3Id]);

  async function add(body: Parameters<typeof api.addKnowledge>[1]) {
    setBusy(true);
    setMsg(null);
    try {
      const { source } = await api.addKnowledge(web3Id, body);
      setMsg({ kind: 'ok', text: `Added "${source.title}" (${source.chunkCount} chunks).` });
      setText('');
      setTextTitle('');
      setUrl('');
      refresh();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    if (DOC_EXT.test(file.name)) {
      const dataBase64 = await fileToBase64(file);
      await add({ kind: 'file', filename: file.name, title: file.name, dataBase64 });
      return;
    }
    if (TEXT_EXT.test(file.name)) {
      const content = await file.text();
      await add({ kind: 'file', filename: file.name, title: file.name, text: content });
      return;
    }
    setMsg({
      kind: 'err',
      text: `"${file.name}" isn't supported — upload a PDF, a .docx, a spreadsheet (.xlsx), or a text file (.txt/.md/.csv…).`,
    });
  }

  async function remove(id: string) {
    try {
      await api.removeKnowledge(web3Id, id);
      refresh();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function runTest() {
    if (!testQ.trim()) return;
    setBusy(true);
    try {
      const { hits: h } = await api.queryKnowledge(web3Id, testQ);
      setHits(h);
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card gchat-kb">
      <h3 className="field-lbl">
        Knowledge base <span className="muted">· {title}</span>
      </h3>
      <p className="hint">
        Attach documents and links so this agent answers from your data (RAG). Retrieved passages
        are cited in its replies.
        {embedder === 'lexical' && (
          <>
            {' '}
            <strong>Basic keyword mode</strong> — install a local embedding model (e.g.{' '}
            <code>ollama pull nomic-embed-text</code>) on the node for semantic search.
          </>
        )}
      </p>

      <div className="chip-pick gchat-kb-tabs">
        {(['text', 'link', 'file'] as const).map((t) => (
          <button
            type="button"
            key={t}
            className={`chip-toggle ${tab === t ? 'on' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'text' ? 'Paste text' : t === 'link' ? 'Add link' : 'Upload file'}
          </button>
        ))}
      </div>

      {tab === 'text' && (
        <div className="field">
          <input
            placeholder="Title (e.g. Return policy)"
            value={textTitle}
            onChange={(e) => setTextTitle(e.target.value)}
          />
          <textarea
            rows={4}
            placeholder="Paste company docs, FAQs, policies…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="button"
            className="btn act btn-sm"
            disabled={busy || !text.trim()}
            onClick={() => add({ kind: 'text', title: textTitle, text })}
          >
            {busy ? 'Indexing…' : 'Add text'}
          </button>
        </div>
      )}

      {tab === 'link' && (
        <div className="field">
          <input
            placeholder="https://your-site.com/about"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="button"
            className="btn act btn-sm"
            disabled={busy || !/^https?:\/\//i.test(url)}
            onClick={() => add({ kind: 'url', url })}
          >
            {busy ? 'Fetching…' : 'Fetch & add'}
          </button>
        </div>
      )}

      {tab === 'file' && (
        <div className="field">
          <input
            type="file"
            accept=".pdf,.docx,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.log,.html,.htm,.xml,.yaml,.yml,.rtf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
          <p className="hint">
            PDF, Word (.docx), Excel (.xlsx), or text files (.txt .md .csv .json …).
            Scanned/image-only PDFs have no extractable text.
          </p>
        </div>
      )}

      {msg && <p className={`hint ${msg.kind === 'ok' ? 'ok' : 'err'}`}>{msg.text}</p>}

      {sources.length > 0 && (
        <ul className="gchat-kb-list">
          {sources.map((s) => (
            <li key={s.id}>
              <span className="gchat-kb-src">
                <strong>{s.title}</strong>
                <span className="muted">
                  {' '}
                  · {s.kind} · {s.chunkCount} chunk{s.chunkCount === 1 ? '' : 's'}
                </span>
              </span>
              <button
                type="button"
                className="btn ghost btn-sm btn-trash"
                onClick={() => remove(s.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {sources.length > 0 && (
        <div className="field gchat-kb-test">
          <label className="field-lbl" htmlFor="kb-test">
            Test retrieval
          </label>
          <div className="gchat-kb-testrow">
            <input
              id="kb-test"
              placeholder="Ask something your docs cover…"
              value={testQ}
              onChange={(e) => setTestQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runTest()}
            />
            <button type="button" className="btn ghost btn-sm" disabled={busy} onClick={runTest}>
              Test
            </button>
          </div>
          {hits && (
            <div className="gchat-kb-hits">
              {hits.length === 0 && <p className="muted">No matching passages.</p>}
              {hits.map((h, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: transient preview list
                <div key={i} className="gchat-kb-hit">
                  <span className="muted">
                    [{h.title}] · {(h.score * 100).toFixed(0)}%
                  </span>
                  <p>{h.text.slice(0, 240)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
