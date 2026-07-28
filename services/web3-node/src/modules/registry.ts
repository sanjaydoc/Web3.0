import { AGENT_CARD_VERSION, formatAmount, isValidWeb3Id, web3Id as makeWeb3Id } from '@web3/core';
import type { AgentCard, RegistrationRequest, SignedEnvelope } from '@web3/core';
import { deriveDid, fromB64u } from '@web3/crypto';
import type { ModuleContext, Web3Module } from '../context.js';
import { checkEnvelope } from '../services/replay.js';

/** True if the body is shaped like a signed envelope (rather than a bare registration request). */
function isEnvelope(body: unknown): body is SignedEnvelope<RegistrationRequest> {
  return (
    !!body &&
    typeof body === 'object' &&
    'payload' in body &&
    'signature' in body &&
    'publicKey' in body
  );
}

/**
 * registry — where agents join the network. On registration an account gets an email-like
 * Web3.0 ID, a DID derived from its post-quantum public key, and a wallet seeded with a faucet
 * grant. Others discover it here.
 */
export function registryModule(): Web3Module {
  return {
    name: 'registry',
    version: '0.1.0',
    register({ http, registry, ledger, bus, replay, store, config, clock }: ModuleContext) {
      http.post('/agents', async (request, reply) => {
        const raw = request.body;

        // Registration must be a signed envelope: the registrant proves possession of the private
        // key by signing the request with the very key being registered. This binds the wallet to
        // that key — nobody can claim a handle (or a wallet) for a key they don't hold.
        let body: Partial<RegistrationRequest> | undefined;
        if (isEnvelope(raw)) {
          const claimed = typeof raw.payload?.local === 'string' ? raw.payload.local : '';
          let expected: ReturnType<typeof makeWeb3Id> | undefined;
          try {
            expected = makeWeb3Id(claimed);
          } catch {
            expected = undefined;
          }
          const outcome = checkEnvelope(replay, raw, expected);
          const keyBinds = raw.payload?.signPublicKey === raw.publicKey;
          if (!outcome.ok || !keyBinds) {
            const reason = !outcome.ok
              ? outcome.reason
              : 'signPublicKey does not match the signing key';
            bus.emit({
              kind: 'auth.rejected',
              summary: `DENY registration · ${reason}`,
              data: {
                policy: 'registration-auth',
                decision: 'DENY',
                reason,
                enforced: config.auth.enforce,
              },
            });
            if (config.auth.enforce)
              return reply.code(401).send({ error: `registration rejected: ${reason}` });
          }
          body = outcome.payload ?? raw.payload;
        } else if (config.auth.enforce) {
          return reply.code(401).send({
            error: 'registration must be a signed envelope (sign the request with your key)',
          });
        } else {
          body = raw as Partial<RegistrationRequest> | undefined;
        }

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
          summary: `${id} joined Web3.0 with ${formatAmount(config.faucetGrant)} · ${did}`,
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
