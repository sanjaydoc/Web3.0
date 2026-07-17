import { AGENT_CARD_VERSION, formatAmount, isValidWeb3Id, web3Id as makeWeb3Id } from '@acp/core';
import type { AgentCard, RegistrationRequest } from '@acp/core';
import { deriveDid, fromB64u } from '@acp/crypto';
import type { AcpModule, ModuleContext } from '../context.js';

/**
 * registry — where agents join the network. On registration an account gets an email-like
 * Web3.0 ID, a DID derived from its post-quantum public key, and a wallet seeded with a faucet
 * grant. Others discover it here.
 */
export function registryModule(): AcpModule {
  return {
    name: 'registry',
    version: '0.1.0',
    register({ http, registry, ledger, bus, store, config, clock }: ModuleContext) {
      http.post('/agents', async (request, reply) => {
        const body = request.body as Partial<RegistrationRequest> | undefined;
        if (!body || typeof body.local !== 'string' || !body.signPublicKey || !body.kemPublicKey) {
          return reply
            .code(400)
            .send({ error: 'local, signPublicKey and kemPublicKey are required' });
        }

        let id: ReturnType<typeof makeWeb3Id>;
        try {
          id = makeWeb3Id(body.local);
        } catch {
          return reply.code(400).send({ error: `invalid handle: "${body.local}"` });
        }
        if (registry.has(id)) return reply.code(409).send({ error: `${id} is already taken` });

        let did: string;
        try {
          did = deriveDid(fromB64u(body.signPublicKey));
        } catch {
          return reply.code(400).send({ error: 'signPublicKey is not valid base64url' });
        }

        const card: AgentCard = {
          web3Id: id,
          did,
          name: body.name ?? id,
          description: body.description ?? '',
          kind: body.kind === 'human' ? 'human' : 'agent',
          skills: Array.isArray(body.skills) ? body.skills : [],
          pricing: body.pricing,
          signPublicKey: body.signPublicKey,
          kemPublicKey: body.kemPublicKey,
          version: AGENT_CARD_VERSION,
          createdAt: clock(),
        };

        registry.add(card);
        await store.saveAgent(card);
        ledger.register(id, did, config.faucetGrant);
        bus.emit({
          kind: 'agent.registered',
          actor: id,
          summary: `${id} joined ACP with ${formatAmount(config.faucetGrant)} · ${did}`,
          data: { did, kind: card.kind, skills: card.skills.map((s) => s.id) },
        });

        return reply.code(201).send({ card, wallet: ledger.getWallet(id) });
      });

      http.get('/agents', () => ({ agents: registry.list(), count: registry.size }));

      http.get('/agents/:web3Id', (request, reply) => {
        const { web3Id } = request.params as { web3Id: string };
        if (!isValidWeb3Id(web3Id)) return reply.code(400).send({ error: 'invalid Web3.0 ID' });
        const card = registry.get(web3Id);
        return card ? { card } : reply.code(404).send({ error: 'not found' });
      });
    },
  };
}
