import type { IdentityRegistry } from './identity.js';
import { type Erc8004Event, SCORE_MAX, SCORE_MIN, type ValidationRecord } from './types.js';
import { normAddr } from './util.js';

/**
 * The Validation Registry — independent verification of an agent's work. A requester asks a named
 * validator to check some work (identified by its `dataHash`); the validator later posts a response
 * (0–100). Keyed by `dataHash`, so the request and its result are linkable. Defers to the Identity
 * Registry to confirm the agent exists, and only the named validator may respond.
 */
export class ValidationRegistry {
  private readonly byHash = new Map<string, ValidationRecord>();

  constructor(
    private readonly identity: IdentityRegistry,
    private readonly clock: () => string,
    private readonly emit?: (e: Erc8004Event) => void,
  ) {}

  /** Request validation of an agent's work. Throws if the agent doesn't exist or the hash repeats. */
  request(params: {
    validator: string;
    agentId: number;
    dataHash: string;
    uri?: string;
  }): ValidationRecord {
    if (!this.identity.getAgent(params.agentId)) throw new Error(`unknown agent ${params.agentId}`);
    if (this.byHash.has(params.dataHash)) throw new Error('dataHash already has a request');
    const rec: ValidationRecord = {
      dataHash: params.dataHash,
      validator: normAddr(params.validator),
      agentId: params.agentId,
      uri: params.uri,
      requestedAt: this.clock(),
    };
    this.byHash.set(params.dataHash, rec);
    this.emit?.({
      kind: 'validation.requested',
      agentId: params.agentId,
      validator: rec.validator,
      dataHash: params.dataHash,
    });
    return rec;
  }

  /** The named validator posts a result. Only the validator in the request may respond, once. */
  respond(params: {
    dataHash: string;
    validator: string;
    value: number;
    uri?: string;
    tag?: string;
  }): ValidationRecord | undefined {
    const rec = this.byHash.get(params.dataHash);
    if (!rec) return undefined;
    if (rec.validator !== normAddr(params.validator)) throw new Error('not the named validator');
    if (rec.response) throw new Error('already responded');
    if (params.value < SCORE_MIN || params.value > SCORE_MAX) {
      throw new Error(`value must be ${SCORE_MIN}–${SCORE_MAX}`);
    }
    rec.response = {
      value: Math.round(params.value),
      uri: params.uri,
      tag: params.tag,
      respondedAt: this.clock(),
    };
    this.emit?.({
      kind: 'validation.responded',
      agentId: rec.agentId,
      dataHash: params.dataHash,
      value: rec.response.value,
    });
    return rec;
  }

  get(dataHash: string): ValidationRecord | undefined {
    return this.byHash.get(dataHash);
  }

  listForAgent(agentId: number): ValidationRecord[] {
    return [...this.byHash.values()].filter((r) => r.agentId === agentId);
  }
}
