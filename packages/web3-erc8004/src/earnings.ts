import type { IdentityRegistry } from './identity.js';
import type {
  CombinedReputation,
  EarningRecord,
  EarningsSummary,
  Erc8004Event,
  FeedbackSummary,
} from './types.js';
import { normAddr } from './util.js';

/**
 * The Earnings Registry — economic reputation drawn from real payments. Every x402 settlement where
 * an agent is the payee is recorded here; the aggregate becomes a bounded "proof of demand" score
 * that composes with feedback. This is the "an agent's wallet is its reputation" idea made concrete:
 * an agent that reliably earns from many payers is, demonstrably, one others chose to pay.
 *
 * The score deliberately weighs payment *count* and *payer diversity*, not raw amount — amounts vary
 * by asset and decimals and are easy to inflate with self-payments, whereas recurring demand from
 * distinct payers is hard to fake.
 */
export class EarningsRegistry {
  private readonly byAgent = new Map<number, EarningRecord[]>();
  private readonly payersByAgent = new Map<number, Set<string>>();

  constructor(
    private readonly identity: IdentityRegistry,
    private readonly emit?: (e: Erc8004Event) => void,
  ) {}

  /** Record a payment received by an agent. Ignored if the agent isn't known. */
  record(params: {
    agentId: number;
    amountAtomic: string;
    asset: string;
    payer: string;
    tx?: string;
    ts: string;
  }): EarningRecord | undefined {
    if (!this.identity.getAgent(params.agentId)) return undefined;
    const rec: EarningRecord = { ...params, payer: normAddr(params.payer) };
    const list = this.byAgent.get(params.agentId) ?? [];
    list.push(rec);
    this.byAgent.set(params.agentId, list);
    const payers = this.payersByAgent.get(params.agentId) ?? new Set<string>();
    payers.add(rec.payer);
    this.payersByAgent.set(params.agentId, payers);
    this.emit?.({
      kind: 'reputation.earning',
      agentId: params.agentId,
      payer: rec.payer,
      amountAtomic: rec.amountAtomic,
    });
    return rec;
  }

  list(agentId: number): EarningRecord[] {
    return [...(this.byAgent.get(agentId) ?? [])];
  }

  summary(agentId: number): EarningsSummary {
    const all = this.byAgent.get(agentId) ?? [];
    const uniquePayers = this.payersByAgent.get(agentId)?.size ?? 0;
    let total = 0n;
    for (const r of all) {
      try {
        total += BigInt(r.amountAtomic);
      } catch {
        /* skip non-integer amounts */
      }
    }
    return {
      agentId,
      totalEarnedAtomic: total.toString(),
      paymentCount: all.length,
      uniquePayers,
      lastPaidAt: all.at(-1)?.ts,
      economicScore: economicScore(all.length, uniquePayers),
    };
  }
}

/**
 * Bounded 0–100 economic score from payment count + payer diversity.
 *   volume  = min(70, 25·log2(1 + count))       — grows with how often the agent is paid
 *   breadth = min(30, 15·log2(1 + uniquePayers)) — rewards distinct (repeat/diverse) payers
 * A single payment from one payer → 40; broad recurring demand → 100. Zero payments → 0.
 */
export function economicScore(paymentCount: number, uniquePayers: number): number {
  if (paymentCount <= 0) return 0;
  const volume = Math.min(70, Math.round(25 * Math.log2(1 + paymentCount)));
  const breadth = Math.min(30, Math.round(15 * Math.log2(1 + uniquePayers)));
  return Math.min(100, volume + breadth);
}

/**
 * Blend feedback and economic reputation into one 0–100 score. When an agent has both, weight
 * feedback 60% / economic 40%; when it has only one dimension, use that one. No signal → 0.
 */
export function combineReputation(
  feedback: FeedbackSummary,
  earnings: EarningsSummary,
): CombinedReputation {
  const hasFeedback = feedback.count > 0;
  const hasEarnings = earnings.paymentCount > 0;
  let score = 0;
  if (hasFeedback && hasEarnings) {
    score = Math.round(0.6 * feedback.averageScore + 0.4 * earnings.economicScore);
  } else if (hasFeedback) {
    score = feedback.averageScore;
  } else if (hasEarnings) {
    score = earnings.economicScore;
  }
  return {
    agentId: feedback.agentId,
    feedbackScore: feedback.averageScore,
    feedbackCount: feedback.count,
    economicScore: earnings.economicScore,
    paymentCount: earnings.paymentCount,
    score,
  };
}
