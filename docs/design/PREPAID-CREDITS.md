# Design: aETH as prepaid credits (Stripe on-ramp)

Status: **roadmap — to be built.** This is what gives aETH *real* value and answers "earn in which
currency?": make aETH a **prepaid platform credit** backed 1:1 by a real fiat/stablecoin reserve —
like OpenAI/AWS credits or a gift card, **not** a launched cryptocurrency.

## Why

Today aETH is faucet-minted and circulates only inside the network — it has **no external value**, so
earning it isn't earning money (the "confetti" problem, and the core of Hole 4 in
[HOLES-AND-OPTIONS.md](HOLES-AND-OPTIONS.md)). Backing aETH with a real reserve makes every fee, the
3% platform cut, and every operator payout **real money**.

## The model

```
Buy credits (fiat/card, via Stripe)  →  aETH credited to your wallet (1:1 against a reserve)
    spend aETH to pay hosts / agents  →  operators + agents EARN aETH (fee-split, non-inflationary)
        operators redeem earned aETH  →  Stripe payout to their bank → aETH debited
```

- **Reserve-backed, 1:1.** Every aETH in circulation from a purchase is backed by real money held in a
  **reserve account**. The platform never mints value out of thin air (consistent with the zero-inflation
  fee model — the only aETH creation is a purchase against reserve; the faucet becomes a *testnet-only*
  free grant, gated/off in production).
- **Prepaid / stored-value, not crypto.** Legally this looks like prepaid credits or a gift card, which
  is far simpler than issuing a token/security. (Still: stored-value can trigger money-transmitter /
  e-money rules above thresholds — see Open questions.)
- **aETH stays exactly as-is internally.** We only add an on-ramp (buy) and off-ramp (redeem) around
  the existing ledger. Everything already built (fees, hosting, mandates, consensus) is untouched.

## Components to build

1. **Buy-credits (on-ramp).** A `POST /credits/checkout` that creates a Stripe Checkout / PaymentIntent
   for the signed-in account; a **Stripe webhook** (`payment_intent.succeeded`) then credits the buyer's
   aETH wallet at the configured peg and moves the fiat into the reserve. Idempotent on the Stripe event id.
2. **Reserve accounting.** A dedicated reserve ledger/wallet tracking fiat in vs aETH issued, so backing
   is auditable and always ≥ circulating purchased aETH. Surface a reserve-ratio metric.
3. **Redeem / payout (off-ramp).** `POST /credits/redeem` — an operator/agent-owner requests cashing out
   earned aETH; debits their aETH and issues a **Stripe payout/transfer** to their connected account.
   Needs Stripe Connect (payouts to third parties) + payout limits/holds.
4. **Peg + pricing.** A configured rate (e.g. 1 aETH = \$X) and buy/redeem spread (the platform's margin,
   on top of / instead of the 3% fee). One config knob, changeable.
5. **Dashboard.** "Buy aETH" + "Cash out" in the Account view; reserve status in the admin console.

## Prerequisites

- **Stripe must be authorized.** The Stripe connector is present but **not yet authorized** in this
  workspace; a headless session can't run its OAuth. Enable it in **claude.ai connector settings**
  before this is built. Buy/redeem also needs **Stripe Connect** for third-party payouts.
- Production **faucet gating** (already on the roadmap) — the free 1,000 aETH must be testnet-only or
  gated, or it undermines the 1:1 backing.

## Open questions

- **Peg:** what is 1 aETH worth, and is it fixed or floating? (Fixed peg = simplest credit model.)
- **Spread/fees:** margin on buy and/or redeem, vs. relying on the 3% network fee.
- **KYC / limits:** identity + caps for redemptions (money-transmitter / e-money exposure by jurisdiction).
- **Custody & compliance:** who holds the reserve; refund/chargeback policy; audit cadence.
- **Redemption eligibility:** can anyone cash out, or only operators/verified accounts?

## Non-goals

- Not an ICO / token sale / speculative crypto asset. aETH is a **utility credit** redeemable at the peg.
- No promise of appreciation — it's spend-and-redeem credit, like API credits.
