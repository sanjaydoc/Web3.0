import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentCard } from '@web3/core';
import { web3Id } from '@web3/core';
import { generateKeypair, toB64u } from '@web3/crypto';
import { Ledger } from '@web3/ledger';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Web3Config } from '../src/config.js';
import { FileStore, createStore, recordStoreMode } from '../src/store/index.js';

const cfg = (over: Partial<Web3Config>): Web3Config => ({ ...(over as Web3Config) });

function sampleAgent(id: string): AgentCard {
  return {
    web3Id: id,
    did: `did:web3:${id}`,
    kind: 'agent',
    name: id,
    skills: [{ id: 'ask', name: 'Ask', description: '…', tags: [] }],
  } as unknown as AgentCard;
}

/** A real, signed ledger entry (so the JSONL round-trip is exercised on a genuine entry). */
function sampleEntry() {
  const keys = generateKeypair();
  const ledger = new Ledger(keys, toB64u(keys.publicKey));
  ledger.register(web3Id('alice'), 'did:web3:alice', 1000);
  return ledger.all()[0]!;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'web3-filestore-'));
  process.env.WEB3_STORE_MODE_FILE = join(dir, 'store-mode');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env.WEB3_STORE_MODE_FILE = '';
});

describe('FileStore (durable on-device persistence)', () => {
  it('persists agents, settings, and ledger entries across a restart (new instance, same dir)', async () => {
    const storeDir = join(dir, 'store');
    const entry = sampleEntry();

    // First "run": create an agent, save hosted config, author a ledger entry.
    const a = new FileStore(storeDir);
    await a.init();
    await a.saveAgent(sampleAgent('sonuagent@web3.0'));
    await a.saveSetting('hosted-agents', [{ handle: 'sonuagent', createdBy: 'tina@web3.0' }]);
    await a.appendEntry(entry);
    await a.close();

    // App closed and reopened: a brand-new instance over the SAME data dir must see it all.
    const b = new FileStore(storeDir);
    await b.init();

    const agents = await b.loadAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]!.web3Id).toBe('sonuagent@web3.0');
    expect(agents[0]!.skills[0]!.id).toBe('ask'); // full fidelity — skills survive, not skeletal

    expect(await b.loadSetting('hosted-agents')).toEqual([
      { handle: 'sonuagent', createdBy: 'tina@web3.0' },
    ]);

    const ledger = await b.loadLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.hash).toBe(entry.hash);
  });

  it('upserts an agent by web3Id (re-saving does not duplicate)', async () => {
    const store = new FileStore(join(dir, 'store'));
    await store.init();
    await store.saveAgent(sampleAgent('bob@web3.0'));
    await store.saveAgent(sampleAgent('bob@web3.0'));
    expect(await store.loadAgents()).toHaveLength(1);
  });

  it('createStore selects the file store when a storePath is set (and no DB is)', () => {
    expect(createStore(cfg({ storePath: join(dir, 'store') })).kind).toBe('file');
  });

  it('a real database still wins over a storePath', () => {
    const store = createStore(
      cfg({ storePath: join(dir, 'store'), postgresUrl: 'postgresql://u:p@127.0.0.1:5432/db' }),
    );
    expect(store.kind).toBe('postgres');
  });

  it('REFUSES to fall back to memory once the node has used the file store', () => {
    recordStoreMode('file');
    expect(() => createStore(cfg({}))).toThrow(/refusing to boot on the in-memory store/);
  });
});
