import { describe, expect, it } from 'vitest';
import {
  IdentityRegistry,
  ReputationRegistry,
  ValidationRegistry,
  buildRegistrationFile,
  deriveAgentAddress,
} from '../src/index.js';

let t = 0;
const clock = () => `2026-07-30T00:00:${String(t++).padStart(2, '0')}.000Z`;

describe('IdentityRegistry', () => {
  it('mints agent tokens and resolves by domain / address', () => {
    const id = new IdentityRegistry(clock);
    const a = id.newAgent({ agentDomain: 'alice@web3.0', did: 'did:web3:zAlice' });
    const b = id.newAgent({ agentDomain: 'bob@web3.0', did: 'did:web3:zBob' });
    expect(a.agentId).toBe(1);
    expect(b.agentId).toBe(2);
    expect(id.resolveByDomain('alice@web3.0')?.agentId).toBe(1);
    expect(id.resolveByAddress(a.agentAddress)?.agentId).toBe(1);
    expect(id.getAgent(2)?.did).toBe('did:web3:zBob');
  });

  it('derives a stable address from identity material (wallet = identity)', () => {
    const id = new IdentityRegistry(clock);
    const a = id.newAgent({ agentDomain: 'carol@web3.0', did: 'did:web3:zCarol' });
    expect(a.agentAddress).toBe(deriveAgentAddress('did:web3:zCarol'));
    expect(a.agentAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('is idempotent by domain (safe to backfill)', () => {
    const id = new IdentityRegistry(clock);
    const a1 = id.newAgent({ agentDomain: 'dave@web3.0' });
    const a2 = id.newAgent({ agentDomain: 'dave@web3.0' });
    expect(a1.agentId).toBe(a2.agentId);
    expect(id.size).toBe(1);
  });

  it('transfers ownership (ERC-721 semantics)', () => {
    const id = new IdentityRegistry(clock);
    const a = id.newAgent({
      agentDomain: 'eve@web3.0',
      owner: '0xaAaA000000000000000000000000000000000001',
    });
    id.transfer(a.agentId, '0xBbBb000000000000000000000000000000000002');
    expect(id.ownerOf(a.agentId)).toBe('0xbbbb000000000000000000000000000000000002');
  });
});

describe('ReputationRegistry', () => {
  it('records bounded feedback and computes a summary', () => {
    const id = new IdentityRegistry(clock);
    const rep = new ReputationRegistry(id, clock);
    const a = id.newAgent({ agentDomain: 'srv@web3.0' });
    rep.giveFeedback({ agentId: a.agentId, client: '0xC1', score: 90, tag1: 'speed' });
    rep.giveFeedback({ agentId: a.agentId, client: '0xC2', score: 70, tag1: 'speed' });
    const s = rep.summary(a.agentId);
    expect(s.count).toBe(2);
    expect(s.averageScore).toBe(80);
    expect(s.byTag.speed).toEqual({ count: 2, average: 80 });
  });

  it('rejects out-of-range scores and unknown agents', () => {
    const id = new IdentityRegistry(clock);
    const rep = new ReputationRegistry(id, clock);
    const a = id.newAgent({ agentDomain: 'srv2@web3.0' });
    expect(() => rep.giveFeedback({ agentId: a.agentId, client: '0xC', score: 101 })).toThrow();
    expect(() => rep.giveFeedback({ agentId: 999, client: '0xC', score: 50 })).toThrow();
  });

  it('lets only the client revoke and only the owner respond', () => {
    const id = new IdentityRegistry(clock);
    const rep = new ReputationRegistry(id, clock);
    const a = id.newAgent({ agentDomain: 'srv3@web3.0', owner: '0xOWNER' });
    const fb = rep.giveFeedback({ agentId: a.agentId, client: '0xClient', score: 40 });
    expect(rep.respondToFeedback(a.agentId, fb.index, '0xNotOwner', 'hi')).toBe(false);
    expect(rep.respondToFeedback(a.agentId, fb.index, '0xOWNER', 'thanks for the feedback')).toBe(
      true,
    );
    expect(rep.revokeFeedback(a.agentId, fb.index, '0xSomeoneElse')).toBe(false);
    expect(rep.revokeFeedback(a.agentId, fb.index, '0xClient')).toBe(true);
    expect(rep.summary(a.agentId).count).toBe(0); // revoked excluded
  });
});

describe('ValidationRegistry', () => {
  it('runs request → response keyed by dataHash, validator-gated', () => {
    const id = new IdentityRegistry(clock);
    const val = new ValidationRegistry(id, clock);
    const a = id.newAgent({ agentDomain: 'worker@web3.0' });
    const hash = '0xabc123';
    val.request({ validator: '0xVAL', agentId: a.agentId, dataHash: hash, uri: 'ipfs://work' });
    expect(() => val.respond({ dataHash: hash, validator: '0xIMPOSTER', value: 100 })).toThrow();
    const rec = val.respond({ dataHash: hash, validator: '0xVAL', value: 95, tag: 'reexecution' });
    expect(rec?.response?.value).toBe(95);
    expect(val.get(hash)?.response?.tag).toBe('reexecution');
    expect(val.listForAgent(a.agentId)).toHaveLength(1);
  });

  it('rejects duplicate requests and unknown agents', () => {
    const id = new IdentityRegistry(clock);
    const val = new ValidationRegistry(id, clock);
    const a = id.newAgent({ agentDomain: 'worker2@web3.0' });
    val.request({ validator: '0xV', agentId: a.agentId, dataHash: '0xdup' });
    expect(() =>
      val.request({ validator: '0xV', agentId: a.agentId, dataHash: '0xdup' }),
    ).toThrow();
    expect(() => val.request({ validator: '0xV', agentId: 999, dataHash: '0xnew' })).toThrow();
  });
});

describe('registration file', () => {
  it('builds an A2A card + ERC-8004 registrations + trust models', () => {
    const id = new IdentityRegistry(clock);
    const a = id.newAgent({
      agentDomain: 'pub@web3.0',
      did: 'did:web3:zPub',
      web3Id: 'pub@web3.0',
    });
    const file = buildRegistrationFile(a, {
      agentRegistry: 'eip155:84532:0xRegistry',
      name: 'Publisher',
      description: 'Publishes things',
      version: '0.1.0',
      signPublicKey: 'base64key',
    });
    expect(file.registrations[0]).toMatchObject({
      agentId: a.agentId,
      agentRegistry: 'eip155:84532:0xRegistry',
    });
    expect(file.trustModels).toContain('feedback');
    expect(file.web3?.did).toBe('did:web3:zPub');
  });
});
