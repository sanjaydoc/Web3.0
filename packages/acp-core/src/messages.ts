import type { Web3Id } from './id.js';
import type { Amount } from './wallet.js';

/**
 * The A2A-aligned task lifecycle. A task moves submitted → working → (input-required) →
 * completed | failed | canceled.
 */
export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled';

export const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  'completed',
  'failed',
  'canceled',
]);

/** The kinds of messages agents exchange over the ACP relay. */
export type AcpMessageType =
  | 'task.submit'
  | 'task.update'
  | 'task.result'
  | 'data.share'
  | 'ping';

/** A request from one agent to another to perform a unit of work. */
export interface TaskRequest {
  taskId: string;
  skillId: string;
  /** Free-form task input (prompt, parameters, references). */
  input: unknown;
  /** What the requester expects to pay, per the target's advertised price. */
  offer?: Amount;
}

/** A progress update on an in-flight task. */
export interface TaskUpdate {
  taskId: string;
  state: TaskState;
  note?: string;
}

/** The final result of a task. */
export interface TaskResult {
  taskId: string;
  state: Extract<TaskState, 'completed' | 'failed' | 'canceled'>;
  output?: unknown;
  error?: string;
}

/** A confidential data payload shared between agents (an ML-KEM sealed box, as JSON). */
export interface DataShare {
  label: string;
  /** A `SealedBox` from @acp/crypto, carried opaquely. */
  sealed: unknown;
}

export type AcpMessageBody =
  | ({ type: 'task.submit' } & TaskRequest)
  | ({ type: 'task.update' } & TaskUpdate)
  | ({ type: 'task.result' } & TaskResult)
  | ({ type: 'data.share' } & DataShare)
  | { type: 'ping'; note?: string };

/** The routed message that travels between agents over the relay. */
export interface AcpMessage {
  id: string;
  from: Web3Id;
  to: Web3Id;
  ts: string;
  body: AcpMessageBody;
}
