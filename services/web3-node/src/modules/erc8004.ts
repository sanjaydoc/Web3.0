import type { EventKind, Web3Id } from '@web3/core';
import {
  type Erc8004Event,
  IdentityRegistry,
  ReputationRegistry,
  ValidationRegistry,
  buildRegistrationFile,
  caip10,
} from '@web3/erc8004';
import type { ModuleContext, Web3Module } from '../context.js';

/**
 * erc8004 — ERC-8004 "Trustless Agents" on a Web3.0 node.
 *
 * Every Web3.0 agent automatically gets an ERC-8004 identity (an agent token that resolves to a
 * registration file), a portable reputation (bounded feedback), and a validation trail — so external
 * agents and indexers built on the standard can **discover and trust** Web3.0 agents. Bridges the
 * post-quantum identity (DID + ML-DSA) into the ERC-8004 shape: the agent's wallet address is its
 * identity, and its reputation travels with it.
 *
 * Ledger-backed (same resolution semantics as the on-chain standard); mirror to real Base contracts
 * by pointing the registry CAIP-10 at a deployed IdentityRegistry.
 */
export function erc8004Module(): Web3Module {
  return {
    name: 'erc8004',
    version: '0.1.0',
    register({ http, registry, bus, config, clock, nodePublicKey }: ModuleContext) {
      // Where these identities live. Ledger by default; set to eip155:<chain>:<addr> to point at a
      // deployed on-chain IdentityRegistry.
      const registryCaip10 =
        process.env.WEB3_ERC8004_REGISTRY ??
        caip10('web3', config.x402?.network ?? 'web3.0', `node:${nodePublicKey.slice(0, 16)}`);

      const emit = (e: Erc8004Event) => {
        const kind: EventKind =
          e.kind === 'reputation.feedback'
            ? 'erc8004.feedback'
            : e.kind === 'validation.requested' || e.kind === 'validation.responded'
              ? 'erc8004.validation'
              : 'erc8004.registered';
        bus.emit({
          kind,
          summary: erc8004Summary(e),
          data: e as unknown as Record<string, unknown>,
        });
      };

      const identity = new IdentityRegistry(clock, emit);
      const reputation = new ReputationRegistry(identity, clock, emit);
      const validation = new ValidationRegistry(identity, clock, emit);

      // Mint an ERC-8004 identity for an agent from its Web3.0 card (idempotent by domain).
      const mintFor = (web3Id: Web3Id, did?: string) => {
        const card = registry.get(web3Id);
        return identity.newAgent({ agentDomain: web3Id, web3Id, did: did ?? card?.did });
      };

      // Backfill identities for agents already known at boot, then mint on every new registration.
      for (const card of registry.list()) mintFor(card.web3Id, card.did);
      bus.subscribe((event) => {
        if (event.kind === 'agent.registered' && event.actor) {
          mintFor(event.actor, (event.data as { did?: string } | undefined)?.did);
        }
      });

      // The registration file (A2A card + ERC-8004 registrations + trust models) for an agent.
      const registrationFile = (agentId: number) => {
        const reg = identity.getAgent(agentId);
        if (!reg) return undefined;
        const card = reg.web3Id ? registry.get(reg.web3Id as Web3Id) : undefined;
        return buildRegistrationFile(reg, {
          agentRegistry: registryCaip10,
          name: card?.name ?? reg.agentDomain,
          description: card?.description ?? 'Web3.0 agent',
          version: card?.version ?? '0.1.0',
          skills: card?.skills,
          signPublicKey: card?.signPublicKey,
          trustModels: ['feedback', 'inference-validation', 'tee-attestation'],
        });
      };

      // ── discovery ────────────────────────────────────────────────────────────────────────────
      http.get('/.well-known/erc8004.json', () => ({
        standard: 'ERC-8004',
        registry: registryCaip10,
        registries: { identity: registryCaip10 },
        agentCount: identity.size,
      }));

      http.get('/erc8004/agents', () => ({
        registry: registryCaip10,
        count: identity.size,
        agents: identity.list(),
      }));

      http.get('/erc8004/agents/:agentId', (request, reply) => {
        const agentId = Number((request.params as { agentId: string }).agentId);
        const reg = identity.getAgent(agentId);
        if (!reg) return reply.code(404).send({ error: 'unknown agent' });
        return { registration: reg, file: registrationFile(agentId) };
      });

      http.get('/erc8004/agents/:agentId/card', (request, reply) => {
        const agentId = Number((request.params as { agentId: string }).agentId);
        const file = registrationFile(agentId);
        return file ?? reply.code(404).send({ error: 'unknown agent' });
      });

      http.get('/erc8004/resolve', (request, reply) => {
        const { address, domain } = request.query as { address?: string; domain?: string };
        const reg = address
          ? identity.resolveByAddress(address)
          : domain
            ? identity.resolveByDomain(domain)
            : undefined;
        return reg ?? reply.code(404).send({ error: 'not found' });
      });

      // Bind a real EVM wallet address to an agent (the "wallet is identity" link, e.g. its x402 payTo).
      http.post('/erc8004/agents/:agentId/bind', (request, reply) => {
        const agentId = Number((request.params as { agentId: string }).agentId);
        const { agentAddress } = (request.body ?? {}) as { agentAddress?: string };
        if (!agentAddress) return reply.code(400).send({ error: 'agentAddress required' });
        const reg = identity.updateAgent(agentId, { agentAddress });
        return reg ?? reply.code(404).send({ error: 'unknown agent' });
      });

      http.post('/erc8004/register', (request, reply) => {
        const { web3Id, did } = (request.body ?? {}) as { web3Id?: string; did?: string };
        if (!web3Id) return reply.code(400).send({ error: 'web3Id required' });
        return { registration: mintFor(web3Id as Web3Id, did) };
      });

      // ── reputation ───────────────────────────────────────────────────────────────────────────
      http.post('/erc8004/agents/:agentId/feedback', (request, reply) => {
        const agentId = Number((request.params as { agentId: string }).agentId);
        const b = (request.body ?? {}) as {
          client?: string;
          score?: number;
          tag1?: string;
          tag2?: string;
          uri?: string;
          fileHash?: string;
        };
        if (!b.client || typeof b.score !== 'number') {
          return reply.code(400).send({ error: 'client and numeric score required' });
        }
        try {
          return {
            feedback: reputation.giveFeedback({ agentId, ...b, client: b.client, score: b.score }),
          };
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      });

      http.get('/erc8004/agents/:agentId/reputation', (request) => {
        const agentId = Number((request.params as { agentId: string }).agentId);
        return { summary: reputation.summary(agentId), feedback: reputation.listFeedback(agentId) };
      });

      http.post('/erc8004/agents/:agentId/feedback/:index/respond', (request, reply) => {
        const { agentId, index } = request.params as { agentId: string; index: string };
        const { owner, response } = (request.body ?? {}) as { owner?: string; response?: string };
        if (!owner || !response)
          return reply.code(400).send({ error: 'owner and response required' });
        const ok = reputation.respondToFeedback(Number(agentId), Number(index), owner, response);
        return ok ? { ok } : reply.code(403).send({ error: 'not the agent owner' });
      });

      http.post('/erc8004/agents/:agentId/feedback/:index/revoke', (request, reply) => {
        const { agentId, index } = request.params as { agentId: string; index: string };
        const { client } = (request.body ?? {}) as { client?: string };
        if (!client) return reply.code(400).send({ error: 'client required' });
        const ok = reputation.revokeFeedback(Number(agentId), Number(index), client);
        return ok ? { ok } : reply.code(403).send({ error: 'not the original client' });
      });

      // ── validation ───────────────────────────────────────────────────────────────────────────
      http.post('/erc8004/validation/request', (request, reply) => {
        const b = (request.body ?? {}) as {
          validator?: string;
          agentId?: number;
          dataHash?: string;
          uri?: string;
        };
        if (!b.validator || typeof b.agentId !== 'number' || !b.dataHash) {
          return reply.code(400).send({ error: 'validator, agentId, dataHash required' });
        }
        try {
          return {
            request: validation.request({
              ...b,
              validator: b.validator,
              agentId: b.agentId,
              dataHash: b.dataHash,
            }),
          };
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      });

      http.post('/erc8004/validation/response', (request, reply) => {
        const b = (request.body ?? {}) as {
          validator?: string;
          dataHash?: string;
          value?: number;
          uri?: string;
          tag?: string;
        };
        if (!b.validator || !b.dataHash || typeof b.value !== 'number') {
          return reply.code(400).send({ error: 'validator, dataHash, numeric value required' });
        }
        try {
          const rec = validation.respond({
            ...b,
            validator: b.validator,
            dataHash: b.dataHash,
            value: b.value,
          });
          return rec ? { record: rec } : reply.code(404).send({ error: 'no such request' });
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      });

      http.get('/erc8004/validation/:dataHash', (request, reply) => {
        const { dataHash } = request.params as { dataHash: string };
        const rec = validation.get(dataHash);
        return rec ?? reply.code(404).send({ error: 'not found' });
      });
    },
  };
}

function erc8004Summary(e: Erc8004Event): string {
  switch (e.kind) {
    case 'identity.registered':
      return `ERC-8004 identity #${e.agentId} · ${e.agentDomain}`;
    case 'identity.transferred':
      return `ERC-8004 identity #${e.agentId} transferred`;
    case 'reputation.feedback':
      return `ERC-8004 feedback on #${e.agentId} · score ${e.score}`;
    case 'validation.requested':
      return `ERC-8004 validation requested for #${e.agentId}`;
    case 'validation.responded':
      return `ERC-8004 validation #${e.agentId} · ${e.value}`;
  }
}
