import { web3Id } from '@web3/core';
import { generateKeypair, toB64u } from '@web3/crypto';
import type { Keypair } from '@web3/crypto';
import { Ledger } from '@web3/ledger';
import { describe, expect, it } from 'vitest';
import type { Block } from '../src/index.js';
import { Blockchain, ConsensusEngine, hashBlock, heaviest, proposeBlock } from '../src/index.js';

/** A test authority: a keypair plus its base64url public key (its on-chain identity). */
function authority(): { keys: Keypair; pub: string } {
  const keys = generateKeypair();
  return { keys, pub: toB64u(keys.publicKey) };
}

/** Produce a couple of real ledger entries to batch into a block. */
function sampleEntries(seed: string) {
  const keys = generateKeypair();
  const ledger = new Ledger(keys, toB64u(keys.publicKey));
  ledger.register(web3Id(`n${seed}1`), `did:acp:z${seed}1`, 1000);
  ledger.register(web3Id(`n${seed}2`), `did:acp:z${seed}2`, 0);
  return ledger.all();
}

describe('PoA consensus', () => {
  it('rotates the proposer round-robin over the authority set', () => {
    const auths = [authority(), authority(), authority()];
    const chain = new Blockchain(auths.map((a) => a.pub));
    expect(chain.expectedProposer(0)).toBe(auths[0]!.pub);
    expect(chain.expectedProposer(1)).toBe(auths[1]!.pub);
    expect(chain.expectedProposer(2)).toBe(auths[2]!.pub);
    expect(chain.expectedProposer(3)).toBe(auths[0]!.pub); // wraps around
  });

  it('an engine proposes only when it is its turn', () => {
    const [a, b] = [authority(), authority()];
    const set = [a.pub, b.pub];
    const engA = new ConsensusEngine(a.keys, a.pub, set);
    const engB = new ConsensusEngine(b.keys, b.pub, set);
    expect(engA.isMyTurn()).toBe(true); // height 0 → authorities[0] = A
    expect(engB.isMyTurn()).toBe(false);
    expect(engB.proposeIfMyTurn([])).toBeNull();
    expect(engA.proposeIfMyTurn([])).not.toBeNull();
  });

  it('rejects a block proposed out of turn', () => {
    const [a, b] = [authority(), authority()];
    const set = [a.pub, b.pub];
    const chain = new Blockchain(set);
    // B forges a block at height 0, but height 0 belongs to A.
    const forged = proposeBlock(b.keys, b.pub, 0, chain.head(), [], new Date().toISOString());
    expect(chain.apply(forged)).toMatchObject({ ok: false, reason: /turn/ });
  });

  it('rejects a tampered block and a forged signature', () => {
    const a = authority();
    const chain = new Blockchain([a.pub]);
    const block = proposeBlock(a.keys, a.pub, 0, chain.head(), sampleEntries('x'), 't');

    const tampered = { ...block, entries: sampleEntries('y') }; // content changed, hash stale
    expect(chain.validate(tampered)).toMatchObject({ ok: false, reason: /hash mismatch/ });

    const wrongSig = authority();
    const badSig = {
      ...block,
      signature: proposeBlock(wrongSig.keys, a.pub, 0, chain.head(), block.entries, 't').signature,
    };
    // Recompute so only the signature is wrong (proposer claims A but signed with another key).
    badSig.hash = hashBlock(badSig);
    expect(chain.validate(badSig)).toMatchObject({ ok: false, reason: /signature|hash/ });
  });

  it('three independent nodes converge on one canonical chain', () => {
    const auths = [authority(), authority(), authority()];
    const set = auths.map((a) => a.pub);
    const nodes = auths.map((a) => new ConsensusEngine(a.keys, a.pub, set));

    // Run several rounds: whoever's turn it is proposes; everyone else applies the same block.
    for (let height = 0; height < 7; height++) {
      const proposer = nodes[height % nodes.length]!;
      const block = proposer.proposeIfMyTurn(sampleEntries(`h${height}`));
      expect(block).not.toBeNull();
      for (const peer of nodes) {
        if (peer === proposer) continue;
        expect(peer.receive(block!)).toMatchObject({ ok: true });
      }
    }

    // Every node agrees: same height, same head, identical block hashes.
    const heads = new Set(nodes.map((n) => n.head()));
    expect(heads.size).toBe(1);
    expect(nodes.every((n) => n.height === 7)).toBe(true);
    const hashesPerNode = nodes.map((n) => n.blocks.map((blk) => blk.hash).join(','));
    expect(new Set(hashesPerNode).size).toBe(1);
    expect(nodes[0]!.chain.verifyChain()).toMatchObject({ ok: true });
  });

  it('fork choice picks the longest valid chain deterministically', () => {
    const auths = [authority(), authority()];
    const set = auths.map((a) => a.pub);
    const build = (n: number): Block[] => {
      const nodes = auths.map((a) => new ConsensusEngine(a.keys, a.pub, set));
      const blocks: Block[] = [];
      for (let h = 0; h < n; h++) {
        const proposer = nodes[h % 2]!;
        const b = proposer.proposeIfMyTurn([]);
        if (!b) throw new Error('expected a block');
        for (const peer of nodes) if (peer !== proposer) peer.receive(b);
        blocks.push(b);
      }
      return blocks;
    };
    const short = build(2);
    const long = build(5);
    const winner = heaviest([short, long], set);
    expect(winner.length).toBe(5);
  });

  it('keeps advancing when an authority is offline (proposer-skip)', () => {
    const auths = [authority(), authority(), authority()];
    const set = auths.map((a) => a.pub);
    const slot = 1000;
    // node 1 is "offline": we never let it propose. nodes 0 and 2 gossip to each other.
    const node0 = new ConsensusEngine(auths[0]!.keys, auths[0]!.pub, set, () => '', slot);
    const node2 = new ConsensusEngine(auths[2]!.keys, auths[2]!.pub, set, () => '', slot);
    const gossip = (b: Block, from: ConsensusEngine) => {
      for (const n of [node0, node2]) if (n !== from) expect(n.receive(b).ok).toBe(true);
    };

    // height 0 — node 0 is in-turn, proposes at t=0.
    const b0 = node0.proposeIfDue(sampleEntries('a'), 0);
    expect(b0?.round).toBe(0);
    gossip(b0!, node0);

    // height 1 — the in-turn authority is node 1 (offline). Nobody may jump in early…
    expect(node0.proposeIfDue([], 500)).toBeNull();
    expect(node2.proposeIfDue([], 500)).toBeNull();
    // …but after one slot, node 2 (round 1) legitimately steps in.
    const b1 = node2.proposeIfDue(sampleEntries('b'), 1000);
    expect(b1?.round).toBe(1);
    gossip(b1!, node2);

    // height 2 — node 2 is in-turn again (round 0).
    const b2 = node2.proposeIfDue(sampleEntries('c'), 1500);
    expect(b2?.round).toBe(0);
    gossip(b2!, node2);

    expect(node0.height).toBe(3);
    expect(node0.head()).toBe(node2.head());
    expect(node0.chain.verifyChain().ok).toBe(true);
  });

  it('verifyChain flips to false if a committed block is altered', () => {
    const a = authority();
    const eng = new ConsensusEngine(a.keys, a.pub, [a.pub]);
    eng.proposeIfMyTurn(sampleEntries('v'));
    eng.proposeIfMyTurn(sampleEntries('w'));
    expect(eng.chain.verifyChain()).toMatchObject({ ok: true });
    // Mutate a committed block's content in place.
    (eng.blocks[1] as { entries: unknown[] }).entries = [];
    expect(eng.chain.verifyChain().ok).toBe(false);
  });
});
