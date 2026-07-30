/**
 * EVM signing for the x402 `exact` scheme — EIP-712 typed-data over an EIP-3009
 * `transferWithAuthorization`, the off-chain authorization a buyer signs so a facilitator can pull
 * the exact amount of USDC on-chain. Built on @noble/curves + @noble/hashes (the same audited noble
 * stack the rest of Web3.0's crypto uses) — no ethers/viem dependency.
 *
 * Correctness note: noble v2's `secp256k1.sign` defaults to `prehash:true` (an extra SHA-256). An
 * EIP-712 digest is already the final 32 bytes to sign, so we pass `prehash:false` on both sign and
 * recover. This module round-trips against its own vectors in the test suite.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import type { ExactEvmAuthorization, PaymentPayload, PaymentRequirements } from './types.js';

export type Hex = string;

// ── low-level bytes/hex helpers ────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length % 2 !== 0) throw new Error('odd-length hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '0x';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A uint256 as a 32-byte big-endian word. */
function word(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('uint256 cannot be negative');
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** A 20-byte address left-padded into a 32-byte word. */
function addrWord(address: string): Uint8Array {
  const bytes = hexToBytes(address);
  if (bytes.length !== 20) throw new Error(`bad address length: ${address}`);
  const out = new Uint8Array(32);
  out.set(bytes, 12);
  return out;
}

const keccak = (data: Uint8Array): Uint8Array => keccak_256(data);

// ── keys & addresses ────────────────────────────────────────────────────────────────────────────

/** Derive the 0x checksummed-lowercase Ethereum address from a secp256k1 private key. */
export function privateKeyToAddress(privateKey: Hex): string {
  const priv = hexToBytes(privateKey);
  const pub = secp256k1.getPublicKey(priv, false); // 65 bytes, 0x04 || X || Y
  const hash = keccak(pub.slice(1));
  return bytesToHex(hash.slice(-20));
}

/** A fresh random secp256k1 private key (0x-hex). */
export function randomPrivateKey(): Hex {
  return bytesToHex(secp256k1.utils.randomSecretKey());
}

/** A fresh 32-byte nonce (0x-hex), single-use per authorization. */
export function randomNonce(): Hex {
  const b = new Uint8Array(32);
  // crypto.getRandomValues is available in Node 20+ and browsers.
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

// ── EIP-712 / EIP-3009 ───────────────────────────────────────────────────────────────────────────

const DOMAIN_TYPEHASH = keccak(
  enc.encode('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
);
const TRANSFER_TYPEHASH = keccak(
  enc.encode(
    'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)',
  ),
);

/** Chain id for a network label. `web3-ledger` gets a stable synthetic id (sign/verify still agree). */
export function chainIdFor(network: string): bigint {
  switch (network) {
    case 'base':
      return 8453n;
    case 'base-sepolia':
      return 84532n;
    case 'web3-ledger':
      return 31337n;
    default:
      return 1n;
  }
}

function domainSeparator(req: PaymentRequirements): Uint8Array {
  const name = req.extra?.name ?? 'USDC';
  const version = req.extra?.version ?? '2';
  return keccak(
    concat(
      DOMAIN_TYPEHASH,
      keccak(enc.encode(name)),
      keccak(enc.encode(version)),
      word(chainIdFor(req.network)),
      addrWord(req.asset),
    ),
  );
}

function structHash(auth: ExactEvmAuthorization): Uint8Array {
  return keccak(
    concat(
      TRANSFER_TYPEHASH,
      addrWord(auth.from),
      addrWord(auth.to),
      word(BigInt(auth.value)),
      word(BigInt(auth.validAfter)),
      word(BigInt(auth.validBefore)),
      hexToBytes(auth.nonce),
    ),
  );
}

/** The EIP-712 digest (32 bytes) a buyer signs for this authorization + asset domain. */
export function transferDigest(auth: ExactEvmAuthorization, req: PaymentRequirements): Uint8Array {
  return keccak(concat(new Uint8Array([0x19, 0x01]), domainSeparator(req), structHash(auth)));
}

/** Sign an EIP-3009 authorization → a 65-byte Ethereum signature (r||s||v), 0x-hex. */
export async function signTransferWithAuthorization(
  auth: ExactEvmAuthorization,
  req: PaymentRequirements,
  privateKey: Hex,
): Promise<string> {
  const digest = transferDigest(auth, req);
  const sig = secp256k1.sign(digest, hexToBytes(privateKey), {
    format: 'recovered',
    prehash: false,
  });
  // noble 'recovered' layout is [recid, r(32), s(32)]; Ethereum wants r||s||v with v = 27 + recid.
  const recid = sig[0] as number;
  const r = sig.slice(1, 33);
  const s = sig.slice(33, 65);
  return bytesToHex(concat(r, s, new Uint8Array([27 + recid])));
}

/** Recover the signer address from a 65-byte Ethereum signature over an authorization. */
export function recoverAuthorizationSigner(
  auth: ExactEvmAuthorization,
  req: PaymentRequirements,
  signature: string,
): string | null {
  const sig = hexToBytes(signature);
  if (sig.length !== 65) return null;
  const r = sig.slice(0, 32);
  const s = sig.slice(32, 64);
  const v = sig[64] as number;
  const recid = v >= 27 ? v - 27 : v;
  try {
    const inst = secp256k1.Signature.fromBytes(concat(r, s), 'compact').addRecoveryBit(recid);
    // recoverPublicKey signs no bytes itself; the digest is final. (noble's default recovery path
    // matches our prehash:false signing — verified by the round-trip test.)
    const pub = inst.recoverPublicKey(transferDigest(auth, req)).toBytes(false);
    return bytesToHex(keccak(pub.slice(1)).slice(-20));
  } catch {
    return null;
  }
}

/** Full cryptographic check of an `exact`-scheme payment against its requirement. */
export function verifyExactPayment(
  payload: PaymentPayload,
  req: PaymentRequirements,
): { valid: true; payer: string } | { valid: false; reason: string } {
  const { authorization, signature } = payload.payload;
  const signer = recoverAuthorizationSigner(authorization, req, signature);
  if (!signer) return { valid: false, reason: 'signature does not recover' };
  if (signer.toLowerCase() !== authorization.from.toLowerCase()) {
    return { valid: false, reason: `signer ${signer} != from ${authorization.from}` };
  }
  return { valid: true, payer: signer };
}
