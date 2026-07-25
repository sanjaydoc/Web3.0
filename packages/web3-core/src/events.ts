import type { Web3Id } from './id.js';

/** A guardrail verdict — the ALLOW/DENY decision the node records for every sensitive action. */
export type Decision = 'ALLOW' | 'DENY';

export interface GuardrailDecision {
  decision: Decision;
  /** Which policy produced the verdict, e.g. `spend-cap`, `rate-limit`, `capability`. */
  policy: string;
  reason: string;
}

/** The categories of events surfaced to the observability dashboard. */
export type EventKind =
  | 'agent.registered'
  | 'account.created'
  | 'skill.created'
  | 'connector.created'
  | 'authority.requested'
  | 'authority.decided'
  | 'authority.staked'
  | 'authority.exited'
  | 'authority.slashed'
  | 'economics.updated'
  | 'message.routed'
  | 'task.updated'
  | 'tx.submitted'
  | 'payment.settled'
  | 'guardrail.decision'
  | 'auth.rejected'
  | 'data.shared';

/** A single observable event in the network's activity feed. */
export interface Web3Event {
  id: string;
  ts: string;
  kind: EventKind;
  /** Who initiated the event, if applicable. */
  actor?: Web3Id;
  /** Who the event is directed at, if applicable. */
  target?: Web3Id;
  /** One-line human-readable summary for the dashboard. */
  summary: string;
  /** Optional structured detail (guardrail verdict, amount, task id, …). */
  data?: Record<string, unknown>;
}
