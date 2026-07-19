import { open } from '@web3/core';
import type { AcpMessage, SignedEnvelope, Web3Id } from '@web3/core';
import { hashJson } from '@web3/crypto';
import type { WebSocket } from 'ws';
import type { AcpModule, ModuleContext } from '../context.js';

interface HelloPayload {
  web3Id: Web3Id;
}

function safeParse(raw: unknown): Record<string, unknown> | null {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

/**
 * messaging — the agent-to-agent relay, ACP's answer to "no agent communication protocol".
 * Agents open a WebSocket, authenticate by signing a hello (proving they hold the key behind
 * their DID), then exchange signed A2A messages. The node verifies every signature, runs
 * guardrails, records message provenance on the ledger, and routes (or queues) to the recipient.
 */
export function messagingModule(): AcpModule {
  return {
    name: 'messaging',
    version: '0.1.0',
    register(ctx: ModuleContext) {
      const { http, registry, ledger, bus, guardrails, connections, replay, config } = ctx;

      http.get('/relay', { websocket: true }, (socket: WebSocket) => {
        let authed: Web3Id | null = null;
        const send = (frame: unknown) => socket.send(JSON.stringify(frame));

        socket.on('message', (raw) => {
          const msg = safeParse(raw);
          if (!msg || typeof msg.kind !== 'string') {
            send({ kind: 'error', reason: 'malformed frame' });
            return;
          }
          if (msg.kind === 'hello') {
            handleHello(msg.envelope as SignedEnvelope<HelloPayload>);
            return;
          }
          if (!authed) {
            send({ kind: 'error', reason: 'not authenticated — send hello first' });
            return;
          }
          if (msg.kind === 'send') {
            handleSend(authed, msg.envelope as SignedEnvelope<AcpMessage>);
            return;
          }
          send({ kind: 'error', reason: `unknown kind "${msg.kind}"` });
        });

        socket.on('close', () => {
          if (authed) connections.unbind(authed);
        });

        function handleHello(envelope: SignedEnvelope<HelloPayload>): void {
          const result = open(envelope);
          if (!result.ok || !result.payload) {
            send({ kind: 'error', reason: `hello rejected: ${result.reason}` });
            return;
          }
          const id = result.payload.web3Id;
          const card = registry.get(id);
          if (!card) {
            send({ kind: 'error', reason: `unknown agent ${id}` });
            return;
          }
          if (result.meta?.signer !== id || card.signPublicKey !== envelope.publicKey) {
            send({ kind: 'error', reason: 'hello key does not match the account' });
            return;
          }
          // Replay/freshness on the hello: a captured hello can't be replayed to hijack a session.
          const fresh = result.meta ? replay.check(result.meta) : { ok: false, reason: 'no meta' };
          if (!fresh.ok) {
            bus.emit({
              kind: 'auth.rejected',
              actor: id,
              summary: `DENY hello · replay: ${fresh.reason}`,
              data: {
                policy: 'replay',
                decision: 'DENY',
                reason: fresh.reason,
                enforced: config.auth.enforce,
              },
            });
            if (config.auth.enforce) {
              send({ kind: 'error', reason: `hello rejected: ${fresh.reason}` });
              return;
            }
          }
          authed = id;
          connections.bind(id, socket);
          const drained = connections.drain(id);
          send({ kind: 'ready', web3Id: id, online: connections.online(), drained });
        }

        function handleSend(from: Web3Id, envelope: SignedEnvelope<AcpMessage>): void {
          const result = open(envelope, from);
          if (!result.ok || !result.payload) {
            send({ kind: 'error', reason: `message rejected: ${result.reason}` });
            return;
          }
          const message = result.payload;
          if (message.from !== from) {
            send({ kind: 'error', reason: 'message.from does not match authenticated agent' });
            return;
          }
          const target = registry.get(message.to);
          if (!target) {
            send({ kind: 'error', reason: `unknown recipient ${message.to}` });
            return;
          }

          // Guardrails: rate-limit every message; capability-check task submissions.
          const verdicts = [guardrails.checkRate(from)];
          if (message.body.type === 'task.submit') {
            verdicts.push(guardrails.checkCapability(target, message.body.skillId));
          }
          const denied = verdicts.find((v) => v.decision === 'DENY');
          if (denied) {
            bus.emit({
              kind: 'guardrail.decision',
              actor: from,
              target: message.to,
              summary: `DENY message · ${denied.policy}: ${denied.reason}`,
              data: { ...denied, messageId: message.id },
            });
            send({ kind: 'denied', ref: message.id, verdict: denied });
            return;
          }

          ledger.recordMessage({
            messageId: message.id,
            from,
            to: message.to,
            bodyType: message.body.type,
            contentHash: hashJson(message.body),
          });
          const routing = connections.sendTo(message.to, { kind: 'deliver', message });
          bus.emit({
            kind: message.body.type === 'task.submit' ? 'task.updated' : 'message.routed',
            actor: from,
            target: message.to,
            summary: `${from} → ${message.to} · ${message.body.type} (${routing})`,
            data: { messageId: message.id, bodyType: message.body.type, routing },
          });
          send({ kind: 'ack', ref: message.id, routing });
        }
      });
    },
  };
}
