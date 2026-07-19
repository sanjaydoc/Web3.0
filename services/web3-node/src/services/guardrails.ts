import type { AgentCard, Amount, GuardrailDecision, Web3Id } from '@web3/core';
import type { GuardrailConfig } from '../config.js';

interface Window {
  value: number;
  resetAt: number;
}

/**
 * The guardrails engine — Web3.0's answer to "no observability or guardrails". Every sensitive
 * action passes a policy check that returns an explicit ALLOW/DENY verdict, which the node
 * records as an event. Policies are intentionally simple and composable for the MVP.
 */
export class Guardrails {
  readonly policies = ['capability', 'rate-limit', 'spend-cap'] as const;

  private readonly spend = new Map<Web3Id, Window>();
  private readonly rate = new Map<Web3Id, Window>();

  constructor(
    private readonly config: GuardrailConfig,
    private readonly nowMs: () => number,
  ) {}

  /** capability policy: the target must actually advertise the requested skill. */
  checkCapability(target: AgentCard, skillId: string): GuardrailDecision {
    const has = target.skills.some((s) => s.id === skillId);
    return has
      ? {
          decision: 'ALLOW',
          policy: 'capability',
          reason: `${target.web3Id} advertises "${skillId}"`,
        }
      : {
          decision: 'DENY',
          policy: 'capability',
          reason: `${target.web3Id} does not advertise "${skillId}"`,
        };
  }

  /** rate-limit policy: cap how many messages an agent may send per window. */
  checkRate(from: Web3Id): GuardrailDecision {
    const count = this.bump(this.rate, from, 1);
    if (count > this.config.rateLimitPerWindow) {
      return {
        decision: 'DENY',
        policy: 'rate-limit',
        reason: `rate limit ${this.config.rateLimitPerWindow}/window exceeded`,
      };
    }
    return {
      decision: 'ALLOW',
      policy: 'rate-limit',
      reason: `within rate limit (${count}/${this.config.rateLimitPerWindow})`,
    };
  }

  /** spend-cap policy: cap how much an agent may send per window. */
  checkSpend(from: Web3Id, amount: Amount): GuardrailDecision {
    const projected = this.peek(this.spend, from) + amount;
    if (projected > this.config.spendCapPerWindow) {
      return {
        decision: 'DENY',
        policy: 'spend-cap',
        reason: `spend cap ${this.config.spendCapPerWindow}/window would be exceeded`,
      };
    }
    this.bump(this.spend, from, amount);
    return {
      decision: 'ALLOW',
      policy: 'spend-cap',
      reason: `within spend cap (${projected}/${this.config.spendCapPerWindow})`,
    };
  }

  private peek(map: Map<Web3Id, Window>, key: Web3Id): number {
    const w = map.get(key);
    return w && w.resetAt > this.nowMs() ? w.value : 0;
  }

  private bump(map: Map<Web3Id, Window>, key: Web3Id, by: number): number {
    const now = this.nowMs();
    const existing = map.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { value: by, resetAt: now + this.config.windowMs };
      map.set(key, fresh);
      return fresh.value;
    }
    existing.value += by;
    return existing.value;
  }
}
