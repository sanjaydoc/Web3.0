import { DEFAULT_CURRENCY, formatAmount, isValidWeb3Id, open } from '@web3/core';
import type { Amount, Currency, SignedEnvelope, Web3Id } from '@web3/core';
import { randomId } from '@web3/crypto';
import { InsufficientFundsError } from '@web3/ledger';
import type { ModuleContext, Web3Module } from '../context.js';
import { CONTRIBUTION_POOL_ID, nodeRewardWalletId } from '../services/contribution.js';
import { BURN_ID } from '../services/economics.js';
import { splitFee } from '../services/fees.js';

/** A signed instruction to move funds. The signature proves the payer authorised it. */
interface PaymentInstruction {
  from: Web3Id;
  to: Web3Id;
  amount: Amount;
  currency?: Currency;
  memo?: string;
  taskId?: string;
}

/**
 * payments — "effortless agentic payments". Agents settle value in the network's native aETH unit on
 * the ledger. Every transfer is a *signed* instruction (post-quantum), checked against the
 * spend-cap guardrail before it settles. The x402 quote endpoint exposes the standard
 * "HTTP 402 Payment Required" handshake so a service can price a skill before doing the work.
 */
export function paymentsModule(): Web3Module {
  return {
    name: 'payments',
    version: '0.1.0',
    register({
      http,
      ledger,
      registry,
      bus,
      guardrails,
      replay,
      settlement,
      treasuryId,
      config,
      economics,
      consensus,
      nodePublicKey,
    }: ModuleContext) {
      // Report the active settlement rail so clients/dashboards can show where value settles.
      http.get('/settlement', () => ({
        mode: config.settlement.mode,
        network: settlement.network,
        description: settlement.describe(),
      }));

      http.get('/wallets/:web3Id', (request, reply) => {
        const { web3Id } = request.params as { web3Id: string };
        if (!isValidWeb3Id(web3Id)) return reply.code(400).send({ error: 'invalid Web3.0 ID' });
        const wallet = ledger.getWallet(web3Id);
        return wallet ? { wallet } : reply.code(404).send({ error: 'no wallet' });
      });

      // x402: quote the price of a skill. Returns HTTP 402 with payment requirements.
      http.get('/x402/quote/:to/:skillId', (request, reply) => {
        const { to, skillId } = request.params as { to: string; skillId: string };
        if (!isValidWeb3Id(to)) return reply.code(400).send({ error: 'invalid Web3.0 ID' });
        const card = registry.get(to);
        if (!card) return reply.code(404).send({ error: 'unknown recipient' });
        if (!card.skills.some((s) => s.id === skillId)) {
          return reply.code(404).send({ error: `${to} does not advertise "${skillId}"` });
        }
        const price = card.pricing?.perTask ?? 0;
        const currency = card.pricing?.currency ?? DEFAULT_CURRENCY;
        return reply.code(402).send({
          x402Version: 1,
          resource: `acp://${to}/${skillId}`,
          accepts: [
            {
              scheme: 'web3-ledger',
              network: 'acp-mvp',
              payTo: to,
              amount: price,
              currency,
              description: `Payment for skill "${skillId}" from ${to}`,
            },
          ],
        });
      });

      // The signed payment rail. Settles a transfer on the ledger.
      http.post('/pay', async (request, reply) => {
        const env = request.body as SignedEnvelope<PaymentInstruction> | undefined;
        if (!env || typeof env !== 'object' || !env.payload) {
          return reply.code(400).send({ error: 'a signed payment envelope is required' });
        }
        const instruction = env.payload;
        const verified = open(env, instruction.from);
        if (!verified.ok)
          return reply.code(401).send({ error: `signature check failed: ${verified.reason}` });

        const payer = registry.get(instruction.from);
        if (!payer) return reply.code(404).send({ error: `unknown payer ${instruction.from}` });
        if (payer.signPublicKey !== env.publicKey) {
          return reply.code(401).send({ error: 'payment key does not match the payer account' });
        }

        // Replay/freshness: a valid signature proves who, not when — reject stale or reused envelopes
        // so a captured /pay can't be resubmitted to drain the payer.
        const fresh = replay.check(env.meta);
        if (!fresh.ok) {
          bus.emit({
            kind: 'auth.rejected',
            actor: instruction.from,
            target: instruction.to,
            summary: `DENY payment · replay: ${fresh.reason}`,
            data: {
              policy: 'replay',
              decision: 'DENY',
              reason: fresh.reason,
              enforced: config.auth.enforce,
            },
          });
          if (config.auth.enforce) {
            return reply.code(401).send({ error: `payment rejected: ${fresh.reason}` });
          }
        }
        if (!registry.has(instruction.to)) {
          return reply.code(404).send({ error: `unknown recipient ${instruction.to}` });
        }
        if (
          typeof instruction.amount !== 'number' ||
          !Number.isInteger(instruction.amount) ||
          instruction.amount <= 0
        ) {
          return reply.code(400).send({ error: 'amount must be a positive integer (minor units)' });
        }

        const verdict = guardrails.checkSpend(instruction.from, instruction.amount);
        bus.emit({
          kind: 'guardrail.decision',
          actor: instruction.from,
          target: instruction.to,
          summary: `${verdict.decision} payment · ${verdict.policy}: ${verdict.reason}`,
          data: { ...verdict, amount: instruction.amount },
        });
        if (verdict.decision === 'DENY') {
          return reply.code(403).send({ error: 'blocked by guardrail', verdict });
        }

        try {
          const entry = ledger.transfer(instruction.from, instruction.to, instruction.amount, {
            memo: instruction.memo,
            taskId: instruction.taskId,
            currency: instruction.currency,
          });
          // Protocol fee: skim a basis-point cut from the payee (live policy from the economics
          // service, GUI-editable). NO minting — the fee is split 1/1/1 across the platform treasury,
          // the node that served this payment (its own withdrawable wallet), and the fee-funded
          // contribution pool. On a solo node (no consensus to run epoch payouts) the pool slice folds
          // into the treasury so it isn't stranded.
          const fee = Math.floor((instruction.amount * economics.feeBps) / 10_000);
          if (fee > 0 && ledger.balanceOf(instruction.to) >= fee) {
            splitFee(
              ledger,
              instruction.to,
              fee,
              {
                treasury: treasuryId as Web3Id,
                node: nodeRewardWalletId(nodePublicKey),
                pool: consensus.enabled ? CONTRIBUTION_POOL_ID : (treasuryId as Web3Id),
              },
              'protocol-fee',
            );
          }
          // Burn sink (EIP-1559-style): a slice of every payment leaves circulation for good —
          // the counterweight to faucet + block-reward minting.
          const burn = Math.floor((instruction.amount * economics.burnBps) / 10_000);
          if (burn > 0 && ledger.balanceOf(instruction.to) >= burn) {
            ledger.transfer(instruction.to, BURN_ID as typeof instruction.to, burn, {
              memo: 'burn',
              taskId: instruction.taskId,
            });
          }
          // Settle the value on the configured rail (internal ledger by default; simulated/testnet
          // stablecoin when configured). The internal ledger remains the accounting source of truth;
          // external rails add a real (or realistic) settlement receipt on top.
          const currency = instruction.currency ?? DEFAULT_CURRENCY;
          const settlementResult = await settlement
            .settle({
              from: instruction.from,
              to: instruction.to,
              amount: instruction.amount,
              currency,
              reference: entry.hash,
            })
            .catch((err) => ({
              network: settlement.network,
              status: 'failed' as const,
              detail: err instanceof Error ? err.message : String(err),
            }));
          const receipt = {
            id: randomId('rcpt'),
            from: instruction.from,
            to: instruction.to,
            amount: instruction.amount,
            currency,
            taskId: instruction.taskId,
            ledgerSeq: entry.seq,
            ledgerHash: entry.hash,
            ts: entry.ts,
            fee,
            netToPayee: instruction.amount - fee,
            settlement: settlementResult,
          };
          bus.emit({
            kind: 'payment.settled',
            actor: instruction.from,
            target: instruction.to,
            summary: `${instruction.from} paid ${instruction.to} ${formatAmount(instruction.amount)}${instruction.taskId ? ` for ${instruction.taskId}` : ''}`,
            data: { ...receipt },
          });
          return reply.code(201).send({
            receipt,
            balances: {
              from: ledger.balanceOf(instruction.from),
              to: ledger.balanceOf(instruction.to),
            },
          });
        } catch (err) {
          if (err instanceof InsufficientFundsError) {
            return reply
              .code(402)
              .send({ error: err.message, balance: err.balance, required: err.required });
          }
          throw err;
        }
      });
    },
  };
}
