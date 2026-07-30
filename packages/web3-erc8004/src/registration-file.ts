import type { AgentRegistration, Caip10, RegistrationFile, TrustModel } from './types.js';

export interface BuildRegistrationOptions {
  /** CAIP-10 id of the registry this identity lives in (e.g. `eip155:84532:0x…` or `web3:acp:node`). */
  agentRegistry: Caip10;
  name: string;
  description: string;
  version: string;
  url?: string;
  skills?: unknown[];
  trustModels?: TrustModel[];
  signPublicKey?: string;
}

/**
 * Build the ERC-8004 registration file for an agent — an A2A Agent Card extended with the
 * `registrations` pointer (which registry + agentId + address prove control) and `trustModels`.
 * This is what an external agent fetches to discover and trust a Web3.0 agent.
 */
export function buildRegistrationFile(
  reg: AgentRegistration,
  opts: BuildRegistrationOptions,
): RegistrationFile {
  return {
    name: opts.name,
    description: opts.description,
    version: opts.version,
    ...(opts.url ? { url: opts.url } : {}),
    ...(opts.skills ? { skills: opts.skills } : {}),
    registrations: [
      { agentId: reg.agentId, agentRegistry: opts.agentRegistry, agentAddress: reg.agentAddress },
    ],
    trustModels: opts.trustModels ?? ['feedback', 'inference-validation'],
    web3: {
      ...(reg.web3Id ? { web3Id: reg.web3Id } : {}),
      ...(reg.did ? { did: reg.did } : {}),
      ...(opts.signPublicKey ? { signPublicKey: opts.signPublicKey } : {}),
    },
  };
}
