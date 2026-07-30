/**
 * The facilitator is the piece x402 makes *permissionless*: it verifies a signed payment and
 * settles it, so a resource server never has to hold keys or watch a chain. A tampered payment
 * fails signature recovery, so a facilitator can't redirect funds — which is exactly why anyone
 * can run one (OpenX402's whole premise).
 *
 * Two implementations:
 *   • LocalFacilitator — verifies the EIP-3009 signature in-process and hands settlement to a
 *     pluggable `SettleFn`. This is what lets a Web3.0 node BE a facilitator (settling on its own
 *     PQC ledger by default, or broadcasting on Base with an operator-supplied signer).
 *   • HttpFacilitator — forwards /verify and /settle to a remote facilitator (OpenX402 / CDP). Flip
 *     to this by setting a facilitator URL; nothing else in the flow changes.
 */

import { verifyExactPayment } from './evm.js';
import { checkPaymentShape } from './server.js';
import type {
  FacilitatorRequest,
  SettleResponse,
  SupportedKinds,
  VerifyResponse,
} from './types.js';
import { X402_VERSION } from './types.js';

export interface Facilitator {
  supported(): Promise<SupportedKinds>;
  verify(req: FacilitatorRequest): Promise<VerifyResponse>;
  settle(req: FacilitatorRequest): Promise<SettleResponse>;
}

/** Given a verified request + recovered payer, actually move the value and return a receipt. */
export type SettleFn = (req: FacilitatorRequest, payer: string) => Promise<SettleResponse>;

export interface LocalFacilitatorOptions {
  /** Scheme/network pairs this facilitator will accept. */
  networks: string[];
  /** How value is actually settled once a payment verifies. */
  settleFn: SettleFn;
  /** Injectable clock (seconds) for deterministic tests. */
  now?: () => number;
}

export class LocalFacilitator implements Facilitator {
  constructor(private readonly opts: LocalFacilitatorOptions) {}

  async supported(): Promise<SupportedKinds> {
    return {
      kinds: this.opts.networks.map((network) => ({
        x402Version: X402_VERSION,
        scheme: 'exact',
        network,
      })),
    };
  }

  async verify(req: FacilitatorRequest): Promise<VerifyResponse> {
    const nowSec = this.opts.now ? this.opts.now() : Math.floor(Date.now() / 1000);
    const shape = checkPaymentShape(req.paymentPayload, req.paymentRequirements, nowSec);
    if (!shape.ok) return { isValid: false, invalidReason: shape.reason };
    const sig = verifyExactPayment(req.paymentPayload, req.paymentRequirements);
    if (!sig.valid) return { isValid: false, invalidReason: sig.reason };
    return { isValid: true, payer: sig.payer };
  }

  async settle(req: FacilitatorRequest): Promise<SettleResponse> {
    const v = await this.verify(req);
    if (!v.isValid || !v.payer) {
      return {
        success: false,
        transaction: '',
        network: req.paymentRequirements.network,
        errorReason: v.invalidReason ?? 'verification failed',
      };
    }
    return this.opts.settleFn(req, v.payer);
  }
}

/** Forward verify/settle to a remote facilitator (OpenX402, CDP, or another Web3.0 node). */
export class HttpFacilitator implements Facilitator {
  constructor(
    private readonly baseUrl: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  async supported(): Promise<SupportedKinds> {
    const res = await fetch(this.url('/supported'), { headers: this.headers });
    if (!res.ok) return { kinds: [] };
    return (await res.json()) as SupportedKinds;
  }

  async verify(req: FacilitatorRequest): Promise<VerifyResponse> {
    const res = await fetch(this.url('/verify'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers },
      body: JSON.stringify(req),
    });
    if (!res.ok) return { isValid: false, invalidReason: `facilitator /verify ${res.status}` };
    return (await res.json()) as VerifyResponse;
  }

  async settle(req: FacilitatorRequest): Promise<SettleResponse> {
    const res = await fetch(this.url('/settle'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      return {
        success: false,
        transaction: '',
        network: req.paymentRequirements.network,
        errorReason: `facilitator /settle ${res.status}`,
      };
    }
    return (await res.json()) as SettleResponse;
  }
}
