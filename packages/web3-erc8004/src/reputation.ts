import type { IdentityRegistry } from './identity.js';
import {
  type Erc8004Event,
  type Feedback,
  type FeedbackSummary,
  SCORE_MAX,
  SCORE_MIN,
} from './types.js';
import { normAddr } from './util.js';

export interface GiveFeedbackParams {
  agentId: number;
  client: string;
  score: number;
  tag1?: string;
  tag2?: string;
  uri?: string;
  fileHash?: string;
}

/**
 * The Reputation Registry — bounded feedback attestations about agents. A client publishes a score
 * (0–100) and optional tags; anyone can read the aggregate. Writes defer to the Identity Registry:
 * the agent must exist, and only the agent's owner may respond to feedback / only the original client
 * may revoke it. That deferral is the ERC-8004 authorization pattern.
 */
export class ReputationRegistry {
  private readonly byAgent = new Map<number, Feedback[]>();

  constructor(
    private readonly identity: IdentityRegistry,
    private readonly clock: () => string,
    private readonly emit?: (e: Erc8004Event) => void,
  ) {}

  /** Publish feedback about an agent. Throws if the agent doesn't exist or the score is out of range. */
  giveFeedback(params: GiveFeedbackParams): Feedback {
    if (!this.identity.getAgent(params.agentId)) {
      throw new Error(`unknown agent ${params.agentId}`);
    }
    if (!Number.isFinite(params.score) || params.score < SCORE_MIN || params.score > SCORE_MAX) {
      throw new Error(`score must be ${SCORE_MIN}–${SCORE_MAX}`);
    }
    const list = this.byAgent.get(params.agentId) ?? [];
    const feedback: Feedback = {
      index: list.length,
      agentId: params.agentId,
      client: normAddr(params.client),
      score: Math.round(params.score),
      tag1: params.tag1,
      tag2: params.tag2,
      uri: params.uri,
      fileHash: params.fileHash,
      ts: this.clock(),
    };
    list.push(feedback);
    this.byAgent.set(params.agentId, list);
    this.emit?.({
      kind: 'reputation.feedback',
      agentId: params.agentId,
      client: feedback.client,
      score: feedback.score,
    });
    return feedback;
  }

  /** A client revokes their own feedback. Only the original client may. */
  revokeFeedback(agentId: number, index: number, client: string): boolean {
    const fb = this.byAgent.get(agentId)?.[index];
    if (!fb || fb.client !== normAddr(client)) return false;
    fb.revoked = true;
    return true;
  }

  /** The agent's owner responds to feedback. Only the owner may. */
  respondToFeedback(agentId: number, index: number, owner: string, response: string): boolean {
    const fb = this.byAgent.get(agentId)?.[index];
    if (!fb) return false;
    if (this.identity.ownerOf(agentId) !== normAddr(owner)) return false;
    fb.response = response;
    return true;
  }

  listFeedback(agentId: number): Feedback[] {
    return [...(this.byAgent.get(agentId) ?? [])];
  }

  /** Aggregate reputation over non-revoked feedback. */
  summary(agentId: number): FeedbackSummary {
    const all = (this.byAgent.get(agentId) ?? []).filter((f) => !f.revoked);
    const byTag: Record<string, { count: number; total: number }> = {};
    let total = 0;
    for (const f of all) {
      total += f.score;
      for (const tag of [f.tag1, f.tag2]) {
        if (!tag) continue;
        const t = byTag[tag] ?? { count: 0, total: 0 };
        t.count += 1;
        t.total += f.score;
        byTag[tag] = t;
      }
    }
    return {
      agentId,
      count: all.length,
      averageScore: all.length ? Math.round(total / all.length) : 0,
      lastScore: all.at(-1)?.score,
      byTag: Object.fromEntries(
        Object.entries(byTag).map(([k, v]) => [
          k,
          { count: v.count, average: Math.round(v.total / v.count) },
        ]),
      ),
    };
  }
}
