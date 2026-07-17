import { isValidWeb3Id } from '@acp/core';
import type { Web3Id } from '@acp/core';
import type { AcpModule, ModuleContext } from '../context.js';

/**
 * naming — resolves an email-like Web3.0 ID (`alice@acp`) to its DID and public keys, the way
 * DNS resolves a hostname. Uniqueness of handles is enforced at registration time.
 */
export function namingModule(): AcpModule {
  return {
    name: 'naming',
    version: '0.1.0',
    register({ http, registry }: ModuleContext) {
      http.get('/resolve/:web3Id', (request, reply) => {
        const { web3Id } = request.params as { web3Id: string };
        if (!isValidWeb3Id(web3Id)) return reply.code(400).send({ error: 'invalid Web3.0 ID' });
        const card = registry.get(web3Id as Web3Id);
        if (!card) return reply.code(404).send({ error: 'not found' });
        return {
          web3Id: card.web3Id,
          did: card.did,
          kind: card.kind,
          signPublicKey: card.signPublicKey,
          kemPublicKey: card.kemPublicKey,
        };
      });
    },
  };
}
