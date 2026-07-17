import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  decodeKeypair,
  deriveDid,
  encodeKeypair,
  generateKeypair,
  generateKemKeypair,
  hashJson,
  open,
  seal,
  sign,
  signString,
  utf8ToBytes,
  verify,
  verifyString,
} from '../src/index.js';

describe('ML-DSA signatures', () => {
  it('signs and verifies a message', () => {
    const keys = generateKeypair();
    const msg = utf8ToBytes('hello agentic internet');
    const sig = sign(keys.secretKey, msg);
    expect(verify(keys.publicKey, msg, sig)).toBe(true);
  });

  it('rejects a tampered message', () => {
    const keys = generateKeypair();
    const sig = sign(keys.secretKey, utf8ToBytes('pay 10 to bob'));
    expect(verify(keys.publicKey, utf8ToBytes('pay 1000 to bob'), sig)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const msg = utf8ToBytes('same message');
    const sig = sign(a.secretKey, msg);
    expect(verify(b.publicKey, msg, sig)).toBe(false);
  });

  it('round-trips string helpers', () => {
    const keys = generateKeypair();
    const sig = signString(keys.secretKey, 'task:123');
    expect(verifyString(keys.publicKey, 'task:123', sig)).toBe(true);
    expect(verifyString(keys.publicKey, 'task:124', sig)).toBe(false);
  });

  it('does not throw on malformed signatures', () => {
    const keys = generateKeypair();
    expect(verifyString(keys.publicKey, 'x', 'not-a-real-signature')).toBe(false);
  });
});

describe('DIDs', () => {
  it('derives a stable did:acp identifier from a public key', () => {
    const seed = new Uint8Array(32).fill(7);
    const a = generateKeypair(seed);
    const b = generateKeypair(seed);
    expect(deriveDid(a.publicKey)).toBe(deriveDid(b.publicKey));
    expect(deriveDid(a.publicKey)).toMatch(/^did:acp:z[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('gives different DIDs to different keys', () => {
    expect(deriveDid(generateKeypair().publicKey)).not.toBe(
      deriveDid(generateKeypair().publicKey),
    );
  });
});

describe('key encoding', () => {
  it('round-trips through base64url', () => {
    const keys = generateKeypair();
    const restored = decodeKeypair(encodeKeypair(keys));
    expect(restored.publicKey).toEqual(keys.publicKey);
    expect(restored.secretKey).toEqual(keys.secretKey);
  });
});

describe('canonical hashing', () => {
  it('is independent of key order', () => {
    expect(hashJson({ a: 1, b: 2 })).toBe(hashJson({ b: 2, a: 1 }));
  });

  it('sorts nested keys deterministically', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe('ML-KEM sealed box', () => {
  it('seals and opens a payload for the recipient', () => {
    const recipient = generateKemKeypair();
    const secret = utf8ToBytes(JSON.stringify({ dataset: 'training-run-42', rows: 1000 }));
    const box = seal(recipient.publicKey, secret);
    expect(open(recipient.secretKey, box)).toEqual(secret);
  });

  it('cannot be opened with the wrong key', () => {
    const recipient = generateKemKeypair();
    const attacker = generateKemKeypair();
    const box = seal(recipient.publicKey, utf8ToBytes('confidential'));
    expect(() => open(attacker.secretKey, box)).toThrow();
  });
});
