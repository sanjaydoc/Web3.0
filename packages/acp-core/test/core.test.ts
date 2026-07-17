import { generateKeypair, toB64u } from '@acp/crypto';
import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  isValidWeb3Id,
  open,
  parseWeb3Id,
  seal,
  toMinorUnits,
  web3Id,
} from '../src/index.js';

const NOW = '2026-07-17T00:00:00.000Z';

describe('Web3.0 IDs', () => {
  it('accepts valid email-like handles', () => {
    expect(isValidWeb3Id('alice@acp')).toBe(true);
    expect(isValidWeb3Id('data-bot.01@acp')).toBe(true);
  });

  it('rejects malformed handles', () => {
    for (const bad of ['alice', 'a@acp', '@acp', 'alice@', 'a b@acp', 'x@@acp']) {
      expect(isValidWeb3Id(bad)).toBe(false);
    }
  });

  it('treats handles case-insensitively (like email)', () => {
    // Uppercase input normalises to a valid lowercase handle.
    expect(isValidWeb3Id('ALICE@ACP')).toBe(true);
    expect(web3Id('Alice')).toBe('alice@acp');
  });

  it('parses into local + namespace', () => {
    expect(parseWeb3Id('bob@acp')).toEqual({ local: 'bob', namespace: 'acp' });
    expect(parseWeb3Id('nope')).toBeNull();
  });
});

describe('wallet amounts', () => {
  it('converts major to minor units', () => {
    expect(toMinorUnits(2.5)).toBe(250);
    expect(toMinorUnits(0.01)).toBe(1);
  });

  it('formats amounts for display', () => {
    expect(formatAmount(250)).toBe('2.50 aUSD');
    expect(formatAmount(0)).toBe('0.00 aUSD');
  });
});

describe('signed envelopes', () => {
  it('seals and opens with a valid signature', () => {
    const keys = generateKeypair();
    const alice = web3Id('alice');
    const env = seal(keys, alice, { hello: 'bob' }, toB64u(keys.publicKey), NOW);
    const result = open(env, alice);
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ hello: 'bob' });
  });

  it('rejects a tampered payload', () => {
    const keys = generateKeypair();
    const alice = web3Id('alice');
    const env = seal(keys, alice, { amount: 10 }, toB64u(keys.publicKey), NOW);
    (env.payload as { amount: number }).amount = 1000;
    expect(open(env).ok).toBe(false);
  });

  it('rejects a mismatched signer', () => {
    const keys = generateKeypair();
    const env = seal(keys, web3Id('alice'), { x: 1 }, toB64u(keys.publicKey), NOW);
    const result = open(env, web3Id('bob'));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('signer mismatch');
  });

  it('rejects a swapped public key that does not match the DID', () => {
    const keys = generateKeypair();
    const other = generateKeypair();
    const env = seal(keys, web3Id('alice'), { x: 1 }, toB64u(keys.publicKey), NOW);
    env.publicKey = toB64u(other.publicKey);
    expect(open(env).ok).toBe(false);
  });
});
