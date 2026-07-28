import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Web3Config } from '../src/config.js';
import { createStore, recordStoreMode } from '../src/store/index.js';

// A throwaway config; only the store-selecting fields matter here.
const cfg = (over: Partial<Web3Config>): Web3Config => ({ ...(over as Web3Config) });

let dir: string;
let modeFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'web3-storeguard-'));
  modeFile = join(dir, 'store-mode');
  process.env.WEB3_STORE_MODE_FILE = modeFile;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env.WEB3_STORE_MODE_FILE = undefined;
  process.env.WEB3_STORE_MODE_FILE = '';
});

/**
 * The permanent guard against the live incident: once a node has run on a real database, it must
 * NOT silently boot on the in-memory store (which drops every account and opens auth). It fails
 * loud instead, so a missing WEB3_POSTGRES_URL crash-loops visibly rather than shipping empty.
 */
describe('store downgrade guard', () => {
  it('records the backend after a real store is chosen', () => {
    recordStoreMode('postgres');
    expect(existsSync(modeFile)).toBe(true);
    expect(readFileSync(modeFile, 'utf8')).toBe('postgres');
  });

  it('REFUSES to fall back to memory once the node has used a database', () => {
    recordStoreMode('postgres'); // node previously ran on Postgres
    expect(() => createStore(cfg({}))).toThrow(/refusing to boot on the in-memory store/);
    // And the message names the marker file so the operator can intentionally reset if they mean to.
    expect(() => createStore(cfg({}))).toThrow(new RegExp(modeFile.replace(/[/\\]/g, '.')));
  });

  it('still selects Postgres when the URL IS present (no false positive)', () => {
    recordStoreMode('postgres');
    const store = createStore(cfg({ postgresUrl: 'postgresql://u:p@127.0.0.1:5432/db' }));
    expect(store.kind).toBe('postgres');
  });

  it('allows memory on a genuinely fresh node (no marker) — dev/single-operator mode', () => {
    expect(createStore(cfg({})).kind).toBe('memory');
  });

  it('allows memory when the node last ran on memory too', () => {
    recordStoreMode('memory');
    expect(createStore(cfg({})).kind).toBe('memory');
  });

  it('is resilient to an unreadable/garbage marker (does not throw on a fresh-looking value)', () => {
    writeFileSync(modeFile, 'memory\n');
    expect(createStore(cfg({})).kind).toBe('memory');
  });
});
