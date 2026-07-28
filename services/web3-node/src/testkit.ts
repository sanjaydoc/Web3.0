import { seal, web3Id } from '@web3/core';
import type { SignedEnvelope, Web3Id, Web3Message } from '@web3/core';
import { generateKemKeypair, generateKeypair, toB64u } from '@web3/crypto';
import type { Keypair } from '@web3/crypto';

/** A minimal in-test agent identity: the key material and helpers to sign Web3.0 payloads. */
export interface TestAgent {
  web3Id: Web3Id;
  keys: Keypair;
  signPublicKey: string;
  kemPublicKey: string;
  /** The raw registration request (unsigned) — useful for asserting on fields or forging. */
  registrationBody: Record<string, unknown>;
  /** The signed registration envelope the node now requires. Post this to `/agents`. */
  registration: SignedEnvelope<Record<string, unknown>>;
}

/** Build a test agent with a fresh post-quantum identity and a signed registration envelope. */
export function makeAgent(local: string, opts: Partial<Record<string, unknown>> = {}): TestAgent {
  const keys = generateKeypair();
  const kem = generateKemKeypair();
  const signPublicKey = toB64u(keys.publicKey);
  const kemPublicKey = toB64u(kem.publicKey);
  const registrationBody = { local, signPublicKey, kemPublicKey, kind: 'agent', ...opts };
  return {
    web3Id: web3Id(local),
    keys,
    signPublicKey,
    kemPublicKey,
    registrationBody,
    registration: seal(
      keys,
      web3Id(local),
      registrationBody,
      signPublicKey,
      new Date().toISOString(),
    ),
  };
}

/** Seal any payload as this agent (for /pay envelopes, hello frames, etc.). */
export function sealAs<T>(
  agent: TestAgent,
  payload: T,
  now = new Date().toISOString(),
): SignedEnvelope<T> {
  return seal(agent.keys, agent.web3Id, payload, agent.signPublicKey, now);
}

/** Build a signed A2A message envelope from `agent` to `to`. */
export function message(
  agent: TestAgent,
  to: Web3Id,
  body: Web3Message['body'],
  id = 'msg1',
): SignedEnvelope<Web3Message> {
  const now = new Date().toISOString();
  const msg: Web3Message = { id, from: agent.web3Id, to, ts: now, body };
  return sealAs(agent, msg, now);
}
