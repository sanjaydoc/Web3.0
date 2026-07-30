import { hashJson } from '@web3/crypto';
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
    register({ http, bus, config, log }: ModuleContext) {
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
    },
  };
}
