import { isValidWeb3Id, web3Id as makeWeb3Id } from '@web3/core';
import type { Web3Id } from '@web3/core';
import { hashJson, randomId } from '@web3/crypto';
import { deriveAgentAddress } from '@web3/erc8004';
import {
  type Facilitator,
  type FacilitatorRequest,
  HttpFacilitator,
  LocalFacilitator,
  type PaymentRequirements,
  type SettleResponse,
  X402_VERSION,
  build402,
  decodePaymentHeader,
  encodeSettleResponse,
  priceRequirement,
  privateKeyToAddress,
} from '@web3/x402';
import type { ModuleContext, Web3Module } from '../context.js';

/** How long a paid skill call waits for the agent's result before returning a settled-but-pending
 *  receipt (the agent still delivers on the A2A channel). */
const INVOKE_TIMEOUT_MS = Number(process.env.WEB3_X402_INVOKE_TIMEOUT_MS ?? 8000);
/** aETH minor units are 2dp; USDC atomic is 6dp. Scale a per-task price into USDC atomic units. */
const toUsdcAtomic = (perTaskMinor: number): string => String(perTaskMinor * 10_000);

/**
 * x402 — the internet-native "HTTP 402 Payment Required" standard, on a Web3.0 node.
 *
 * This module makes a node two things at once:
 *   • a **permissionless facilitator** (`/x402/verify`, `/x402/settle`, `/x402/supported`) — anyone
 *     can point an x402 server at it to accept USDC, exactly like OpenX402. It verifies the EIP-3009
 *     signature in-process (a tampered payment fails recovery, so the facilitator can't redirect
 *     funds) and settles either on the local PQC ledger or by forwarding to an upstream facilitator.
 *   • a **priced resource server** — the built-in `/x402/demo/markets/top` returns a real HTTP 402
 *     to an unpaid request and the data once an `X-PAYMENT` header settles. No API keys, no signup.
 *
 * Post-quantum note: the payment envelope is classical (EVM/secp256k1, to interoperate with the
 * wider x402 world), but the ledger that records the settlement is the same ML-DSA-signed ledger as
 * the rest of Web3.0 — so the audit trail stays quantum-resistant even where the rail isn't.
 */
export function x402Module(): Web3Module {
  return {
    name: 'x402',
    version: '0.1.0',
    register({ http, bus, config, log, registry, connections, clock }: ModuleContext) {
      if (!config.x402.enabled) return;

      const x = config.x402;
      // Resolve the receiving address: explicit payTo wins; else derive from an operator key.
      const key = process.env.WEB3_X402_KEY;
      const payTo = x.payTo || (key ? privateKeyToAddress(key) : '');
      if (!payTo) {
        log.warn('x402: no payTo configured (set WEB3_X402_PAYTO); priced resources disabled');
      }

      // A rolling window of recent settlements, surfaced for the operator console / demos.
      const receipts: Array<SettleResponse & { at: string; amount: string; resource?: string }> =
        [];
      const remember = (r: SettleResponse, amount: string, resource?: string) => {
        receipts.push({ ...r, amount, resource, at: new Date().toISOString() });
        if (receipts.length > 200) receipts.shift();
      };

      /**
       * Ledger-mirror settlement: verification already proved the signature; we record the payment
       * on the node (event feed + receipts) and return a deterministic tx reference derived from the
       * authorization. Honest by construction — it never claims an on-chain hash it doesn't have.
       */
      const ledgerFacilitator = new LocalFacilitator({
        networks: [x.network],
        settleFn: async (req: FacilitatorRequest, payer: string): Promise<SettleResponse> => {
          const auth = req.paymentPayload.payload.authorization;
          const tx = `0x${hashJson(['x402', payer, auth.to, auth.value, auth.nonce])}`;
          const result: SettleResponse = {
            success: true,
            transaction: tx,
            network: x.network,
            payer,
            ...(x.explorerBaseUrl ? { explorerUrl: `${x.explorerBaseUrl}${tx}` } : {}),
          };
          bus.emit({
            kind: 'x402.settled',
            summary: `x402 settled ${auth.value} on ${x.network} · ${payer.slice(0, 10)}…`,
            data: {
              payer,
              payTo: auth.to,
              amount: auth.value,
              network: x.network,
              asset: x.asset,
              tx,
            },
          });
          return result;
        },
      });

      // Upstream mode forwards verify/settle to a real facilitator (OpenX402 / CDP) for live
      // on-chain settlement. Flip with WEB3_X402_SETTLE=upstream + WEB3_X402_FACILITATOR_URL.
      const facilitator: Facilitator =
        x.settle === 'upstream' && x.facilitatorUrl
          ? new HttpFacilitator(x.facilitatorUrl)
          : ledgerFacilitator;

      log.info(
        `x402: facilitator ready (${x.settle}${x.facilitatorUrl ? ` → ${x.facilitatorUrl}` : ''}) on ${x.network}`,
      );

      // ── facilitator API (the node AS a permissionless facilitator) ──────────────────────────────
      http.get('/x402/supported', () => facilitator.supported());

      http.post('/x402/verify', async (request, reply) => {
        const body = request.body as FacilitatorRequest | undefined;
        if (!body?.paymentPayload || !body?.paymentRequirements) {
          return reply.code(400).send({ error: 'paymentPayload and paymentRequirements required' });
        }
        return facilitator.verify(body);
      });

      http.post('/x402/settle', async (request, reply) => {
        const body = request.body as FacilitatorRequest | undefined;
        if (!body?.paymentPayload || !body?.paymentRequirements) {
          return reply.code(400).send({ error: 'paymentPayload and paymentRequirements required' });
        }
        const result = await facilitator.settle(body);
        if (result.success) {
          remember(result, body.paymentPayload.payload.authorization.value);
        }
        return result;
      });

      http.get('/x402/receipts', () => ({ receipts: [...receipts].reverse() }));

      // ── a real priced resource (the screenshot's getpredictiondata.xyz, in-node) ─────────────────
      const demoRequirement = (request: {
        protocol: string;
        host: string;
        url: string;
      }): PaymentRequirements =>
        priceRequirement({
          resource: `${request.protocol}://${request.host}${request.url}`,
          atomicAmount: x.demoPriceAtomic,
          payTo,
          network: x.network,
          asset: x.asset,
          domain: { name: x.domainName, version: x.domainVersion },
          description: 'Top prediction markets by volume — priced per query via x402.',
        });

      http.get('/x402/demo/markets/top', async (request, reply) => {
        const req = demoRequirement(request as { protocol: string; host: string; url: string });
        if (!payTo) {
          return reply.code(503).send({ error: 'x402 resource has no payTo configured' });
        }
        const payload = decodePaymentHeader(request.headers['x-payment'] as string | undefined);
        if (!payload) {
          return reply
            .code(402)
            .send(build402(req, 'Payment required — retry with an X-PAYMENT header'));
        }
        const settlement = await facilitator.settle({
          x402Version: X402_VERSION,
          paymentPayload: payload,
          paymentRequirements: req,
        });
        if (!settlement.success) {
          return reply.code(402).send(build402(req, settlement.errorReason ?? 'settlement failed'));
        }
        remember(settlement, req.maxAmountRequired, req.resource);
        reply.header('X-PAYMENT-RESPONSE', encodeSettleResponse(settlement));
        return {
          asOf: new Date().toISOString(),
          paid: {
            amount: req.maxAmountRequired,
            asset: x.asset,
            network: x.network,
            tx: settlement.transaction,
          },
          markets: [
            {
              id: 'btc-100k-2026',
              question: 'BTC ≥ $100k by EOY 2026',
              yes: 0.62,
              volumeUsd: 4_820_000,
            },
            {
              id: 'agi-2027',
              question: 'Frontier lab declares AGI by 2027',
              yes: 0.18,
              volumeUsd: 2_140_000,
            },
            {
              id: 'x402-standard',
              question: 'x402 adopted by a top-5 cloud by 2027',
              yes: 0.41,
              volumeUsd: 1_060_000,
            },
          ],
        };
      });

      // ── every priced agent is automatically an x402 API ──────────────────────────────────────────
      //
      // #1 auto-price: any agent registered with `pricing.perTask` gets a paywalled endpoint per
      //    skill — no extra setup, the agent earns via x402 out of the box.
      // #2 auto-bind: the receiving wallet is the agent's ERC-8004 address, derived deterministically
      //    from its DID (identical to what the erc8004 module minted), so payments settle to the
      //    agent AND auto-credit its economic reputation. No manual bind step.

      /** The purchasable skills of an agent (only those with a positive per-task price). */
      const pricedSkills = (card: {
        web3Id: string;
        did: string;
        skills: { id: string; name: string }[];
        pricing?: { perTask: number; currency: string };
      }) => {
        const perTask = card.pricing?.perTask ?? 0;
        if (perTask <= 0 || !card.did) return [];
        const payToAddr = deriveAgentAddress(card.did);
        return card.skills.map((s) => ({
          web3Id: card.web3Id,
          skillId: s.id,
          name: s.name,
          priceAtomic: toUsdcAtomic(perTask),
          priceUsd: (perTask / 100).toFixed(2),
          asset: x.asset,
          network: x.network,
          payTo: payToAddr,
          endpoint: `/x402/call/${card.web3Id}/${s.id}`,
        }));
      };

      // Discovery: the catalogue of pay-per-call agent skills on this node.
      http.get('/x402/directory', () => {
        const services = registry.list().flatMap((card) => pricedSkills(card));
        return { count: services.length, asset: x.asset, network: x.network, services };
      });

      /**
       * Dispatch a paid task to the agent over the A2A connection hub and wait (briefly) for its
       * result. Hosted/connected agents answer synchronously; if the agent is offline the task
       * queues and we return a settled-but-pending receipt (payment is final either way).
       */
      let buyerSeq = 0;
      const dispatchAndAwait = async (
        to: string,
        input: Record<string, unknown>,
      ): Promise<Record<string, unknown>> => {
        const taskId = `x402_${randomId()}`;
        const buyerId = makeWeb3Id(`x402buyer${++buyerSeq}`);
        let resolveResult: (v: Record<string, unknown> | null) => void = () => {};
        const waitResult = new Promise<Record<string, unknown> | null>((res) => {
          resolveResult = res;
        });
        // A virtual socket that captures the agent's task.result reply (same shape the hub expects).
        const socket = {
          readyState: 1,
          OPEN: 1,
          send(data: string) {
            try {
              const msg = JSON.parse(data) as {
                message?: { body?: { type?: string; state?: string; output?: unknown } };
              };
              if (msg.message?.body?.type === 'task.result') resolveResult(msg.message.body);
            } catch {
              /* ignore non-JSON frames */
            }
          },
        };
        // `to` is already a full Web3.0 ID (e.g. seller@web3.0) — pass it through as-is.
        const online = connections.isOnline(to as Web3Id);
        connections.bind(buyerId, socket as never);
        const routed = connections.sendTo(to as Web3Id, {
          kind: 'deliver',
          message: {
            id: `m_${taskId}`,
            from: buyerId,
            to,
            ts: clock(),
            body: { type: 'task.submit', taskId, input },
          },
        });
        // Only wait for a synchronous result if the agent is actually connected; otherwise the task
        // is queued and it'll deliver on the A2A channel — no point blocking the HTTP response.
        if (!online) {
          connections.unbind(buyerId);
          return {
            delivery: 'queued',
            taskId,
            note: 'Payment settled. The agent is offline; it will deliver on the A2A channel.',
          };
        }
        const result = await Promise.race([
          waitResult,
          new Promise<null>((res) => setTimeout(() => res(null), INVOKE_TIMEOUT_MS)),
        ]);
        connections.unbind(buyerId);
        if (result) {
          return {
            delivery: 'completed',
            taskId,
            state: result.state ?? 'completed',
            output: result.output,
          };
        }
        return {
          delivery: routed === 'delivered' ? 'pending' : 'queued',
          taskId,
          note: 'Payment settled. The agent will deliver the result on the A2A channel.',
        };
      };

      // The paywall: pay the agent's price, then it runs the skill. GET (?q=) or POST ({ input }).
      const callSkill = async (
        request: {
          protocol: string;
          host: string;
          url: string;
          method: string;
          headers: Record<string, unknown>;
          params: unknown;
          query: unknown;
          body: unknown;
        },
        reply: {
          code: (n: number) => { send: (b: unknown) => unknown };
          header: (k: string, v: string) => void;
        },
      ) => {
        const { web3Id, skillId } = request.params as { web3Id: string; skillId: string };
        if (!isValidWeb3Id(web3Id)) return reply.code(400).send({ error: 'invalid Web3.0 ID' });
        const card = registry.get(web3Id as Web3Id);
        if (!card) return reply.code(404).send({ error: `unknown agent ${web3Id}` });
        const skill = card.skills.find((s) => s.id === skillId);
        if (!skill) return reply.code(404).send({ error: `${web3Id} has no skill "${skillId}"` });
        const perTask = card.pricing?.perTask ?? 0;
        if (perTask <= 0 || !card.did) {
          return reply.code(400).send({ error: `"${skillId}" is not x402-priced` });
        }
        const req = priceRequirement({
          resource: `${request.protocol}://${request.host}${request.url}`,
          atomicAmount: toUsdcAtomic(perTask),
          payTo: deriveAgentAddress(card.did),
          network: x.network,
          asset: x.asset,
          domain: { name: x.domainName, version: x.domainVersion },
          description: `${skill.name} — ${web3Id} · $${(perTask / 100).toFixed(2)} per call`,
        });
        const payload = decodePaymentHeader(request.headers['x-payment'] as string | undefined);
        if (!payload) {
          return reply.code(402).send(build402(req, `Payment required for "${skillId}"`));
        }
        const settlement = await facilitator.settle({
          x402Version: X402_VERSION,
          paymentPayload: payload,
          paymentRequirements: req,
        });
        if (!settlement.success) {
          return reply.code(402).send(build402(req, settlement.errorReason ?? 'settlement failed'));
        }
        remember(settlement, req.maxAmountRequired, req.resource);
        reply.header('X-PAYMENT-RESPONSE', encodeSettleResponse(settlement));
        const q = (request.query ?? {}) as { q?: string; question?: string };
        const input =
          request.method === 'GET'
            ? { question: q.q ?? q.question ?? '' }
            : (((request.body as { input?: Record<string, unknown> })?.input ??
                request.body ??
                {}) as Record<string, unknown>);
        const delivery = await dispatchAndAwait(web3Id, input);
        return {
          paid: {
            amount: req.maxAmountRequired,
            asset: x.asset,
            network: x.network,
            tx: settlement.transaction,
            payer: settlement.payer,
          },
          agent: web3Id,
          skill: skillId,
          ...delivery,
        };
      };

      http.get('/x402/call/:web3Id/:skillId', callSkill as never);
      http.post('/x402/call/:web3Id/:skillId', callSkill as never);
    },
  };
}
