# @web3/x402

Internet-native payments for Web3.0 agents — an implementation of the [x402](https://www.x402.org)
"HTTP 402 Payment Required" standard. Interoperates with the official `x402-fetch` client and
[OpenX402](https://openx402.ai) / CDP facilitators. Built on `@noble/curves` + `@noble/hashes` — no
ethers/viem.

## What's in the box

- **Wire types** (`types.ts`) — `PaymentRequirements`, `PaymentPayload`, the 402 body, facilitator
  requests/responses. Matches the x402 v1 spec.
- **EIP-3009 signing** (`evm.ts`) — sign/verify a `transferWithAuthorization` (EIP-712, secp256k1),
  the `exact` scheme's off-chain USDC authorization.
- **Client** (`client.ts`) — `x402Fetch(url, { wallet })`: fetch, and if the server answers 402,
  sign and retry with an `X-PAYMENT` header. One call, no accounts.
- **Server** (`server.ts`) — `priceRequirement`, `build402`, `decodePaymentHeader`,
  `checkPaymentShape`, `encodeSettleResponse`.
- **Facilitator** (`facilitator.ts`) — `LocalFacilitator` (verify in-process, settle via a pluggable
  `SettleFn`) and `HttpFacilitator` (forward to OpenX402 / CDP / another node).

## Pay for something

```ts
import { x402Fetch, walletFromPrivateKey } from '@web3/x402';

const wallet = walletFromPrivateKey(process.env.WALLET_KEY!);
const { response, paid, amountPaid } = await x402Fetch('https://api.example/v1/data', { wallet });
// paid === true, amountPaid === '50000' (atomic USDC), response.status === 200
```

## Charge for something

```ts
import { build402, priceRequirement, decodePaymentHeader, LocalFacilitator } from '@web3/x402';

const req = priceRequirement({
  resource: 'https://api.example/v1/data',
  atomicAmount: '50000',            // $0.05 USDC (6dp)
  payTo: '0xYourReceivingAddress',
  network: 'base-sepolia',
});

// Unpaid → 402:
if (!request.headers['x-payment']) return reply.code(402).send(build402(req));

// Paid → verify + settle, then serve:
const facilitator = new LocalFacilitator({ networks: ['base-sepolia'], settleFn });
const result = await facilitator.settle({
  x402Version: 1,
  paymentPayload: decodePaymentHeader(request.headers['x-payment'])!,
  paymentRequirements: req,
});
if (result.success) reply.header('X-PAYMENT-RESPONSE', encodeSettleResponse(result));
```

The `exact` scheme is trust-minimizing: the buyer signs the authorization, so a facilitator that
tampers with the amount or recipient breaks signature recovery and can't redirect funds. That's why
a facilitator can be permissionless.

## Test

```
pnpm --filter @web3/x402 test
```
