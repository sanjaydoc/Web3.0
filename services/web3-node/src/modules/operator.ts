import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname } from 'node:path';
import { formatAmount } from '@web3/core';
import type { Web3Id } from '@web3/core';
import { CONFIG_FILE_PATH } from '../config.js';
import type { ModuleContext, Web3Module } from '../context.js';
import { checkAdmin } from '../services/admin.js';
import { currentAccount, requireAuthed, requireRole } from '../services/auth.js';
import { STAKE_ESCROW_ID, STAKE_MEMO_PREFIX, UNSTAKE_MEMO_PREFIX } from '../services/consensus.js';
import { ContributionService, nodeRewardWalletId } from '../services/contribution.js';

/** A requested exit: the stake refund matures after the cooldown (Ethereum-style withdrawal delay). */
export interface PendingExit {
  address: string; // the staker being refunded
  nodePublicKey: string; // the key whose stake is exiting
  amount: number;
  requestedAt: string;
  availableAt: string; // requestedAt + cooldown
}

export const EXITS_KEY = 'unstake-exits';

/** An operator's self-reported node position, shown on the Network map. Opt-in only. */
export interface NodeLocation {
  address: string; // account that set it (one location per account)
  label: string; // display name, e.g. "Chennai"
  lat: number;
  lon: number;
  updatedAt: string;
}

export const LOCATIONS_KEY = 'node-locations';

/** What this node IS in the network: solo (own chain), relay (follows the chain), authority (signs it). */
export type NodeRole = 'solo' | 'relay' | 'authority';

/** An operator asking the admin to promote their node into the authority set. */
export interface AuthorityRequest {
  address: string; // requesting account (one open request per account)
  nodePublicKey: string; // the node key to add to WEB3_AUTHORITIES if approved
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt?: string;
  decidedBy?: string;
}

export const AUTHORITY_REQUESTS_KEY = 'authority-requests';

export interface NodeLimits {
  /** Whether this node offers spare compute to host others' agents. */
  contribute: boolean;
  /** RAM (MB) the operator is willing to contribute (0 = no cap). */
  maxRamMb: number;
  /** Max agents this node will host (0 = no cap). */
  maxAgents: number;
}

const DEFAULT_LIMITS: NodeLimits = { contribute: true, maxRamMb: 0, maxAgents: 0 };
export const LIMITS_KEY = 'node-limits';

/**
 * operator — the "my node" console for whoever runs the node: live earnings (treasury balance,
 * fees vs block rewards), traffic, resource usage (RAM, uptime), and the resources they choose to
 * contribute. Read endpoints are open; changing limits is admin-gated.
 */
export function operatorModule(): Web3Module {
  return {
    name: 'operator',
    version: '0.1.0',
    register(ctx: ModuleContext) {
      const { http, ledger, registry, connections, consensus, settlement, config, treasuryId } =
        ctx;

      // This node's per-node contribution-reward wallet (derived from the node key) — where
      // Proof-of-Contribution epoch payouts for THIS node land, distinct from the shared treasury.
      const rewardWalletId = nodeRewardWalletId(ctx.nodePublicKey);

      const earnings = () => {
        let fees = 0;
        let rewards = 0;
        for (const e of ledger.all()) {
          if (e.type !== 'payment') continue;
          const d = e.data as { to: Web3Id; from: Web3Id | null; amount: number; memo?: string };
          if (d.to !== treasuryId) continue;
          if (d.from === null) rewards += d.amount;
          else if (d.memo === 'protocol-fee') fees += d.amount;
        }
        const balance = ledger.balanceOf(treasuryId as Web3Id);
        // Contribution rewards accrue to the node's own reward wallet, not the treasury.
        const contribution = ledger.balanceOf(rewardWalletId);
        return { balance, fees, rewards, contribution, formatted: formatAmount(balance) };
      };

      // Live Proof-of-Contribution status for THIS node: its current score, the pool it competes
      // for, and how many other nodes are live this window.
      const contributionSummary = () => {
        const weights = {
          uptime: ctx.economics.uptimeWeight,
          host: ctx.economics.hostWeight,
          relay: ctx.economics.relayWeight,
        };
        const live = ctx.contribution.live();
        const mine = live.find((r) => r.nodeKey === ctx.nodePublicKey) ?? null;
        const myScore = mine ? ContributionService.score(mine, weights) : 0;
        const totalScore = live.reduce((s, r) => s + ContributionService.score(r, weights), 0);
        const pool = ctx.economics.nodeRewardPool;
        const capBps = ctx.economics.rewardCapBps;
        // Projected next-epoch payout for this node (proportional share, then per-node cap).
        const rawShare = pool > 0 && totalScore > 0 ? Math.floor((pool * myScore) / totalScore) : 0;
        const cap = capBps > 0 ? Math.floor((pool * capBps) / 10_000) : pool;
        const walletBalance = ledger.balanceOf(rewardWalletId);
        return {
          enabled: pool > 0,
          pool,
          epochBlocks: ctx.economics.epochBlocks,
          liveContributors: live.length,
          myScore: Number(myScore.toFixed(3)),
          totalScore: Number(totalScore.toFixed(3)),
          projectedPerEpoch: Math.min(rawShare, cap),
          walletId: rewardWalletId,
          walletBalance,
          walletFormatted: formatAmount(walletBalance),
        };
      };

      const resources = () => {
        const mem = process.memoryUsage();
        return {
          uptimeSec: Math.floor((Date.now() - ctx.startedAt) / 1000),
          processRssMb: Math.round(mem.rss / 1048576),
          heapUsedMb: Math.round(mem.heapUsed / 1048576),
          systemTotalMb: Math.round(os.totalmem() / 1048576),
          systemFreeMb: Math.round(os.freemem() / 1048576),
          // os.cpus() returns undefined on some platforms (notably Android 8+ / nodejs-mobile, where
          // the mobile-node app runs) — guard so a missing value degrades to 0 instead of throwing.
          cpus: os.cpus()?.length ?? 0,
          loadAvg1: Number((os.loadavg()[0] ?? 0).toFixed(2)),
        };
      };

      // solo = not part of a shared chain; relay = follows/verifies it; authority = signs blocks.
      const nodeRole = (): NodeRole => {
        const status = consensus.status();
        if (!status.enabled) return 'solo';
        return status.authorities.includes(ctx.nodePublicKey) ? 'authority' : 'relay';
      };

      http.get('/node', async () => {
        const limits = (await ctx.store.loadSetting<NodeLimits>(LIMITS_KEY)) ?? DEFAULT_LIMITS;
        const status = consensus.status();
        return {
          role: nodeRole(),
          nodePublicKey: ctx.nodePublicKey,
          treasuryId,
          uptimeSec: resources().uptimeSec,
          // Auth visibility (counts + booleans only, no identities): if accounts failed to load,
          // `openMode` flips true and privileged endpoints answer any caller — the exact state that
          // makes `/operator/*` look like it "accepts" a token while `/accounts/me` correctly 401s.
          auth: {
            accounts: ctx.accounts.list().length,
            hasAdmin: ctx.accounts.hasAdmin(),
            openMode: !ctx.accounts.hasAccounts() && !process.env.WEB3_ADMIN_TOKEN,
            // When true, this is the network's main node: non-admins are directed to run their own
            // node instead of operating against it (compute/hosting here is admin-only).
            adminOnly: config.adminOnly,
          },
          earnings: earnings(),
          contribution: contributionSummary(),
          traffic: {
            agents: registry.size,
            online: connections.online().length,
            ledgerEntries: ledger.size,
          },
          consensus: {
            mode: status.mode,
            authorities: status.authorities.length,
            height: status.height,
            peers: status.peers.length,
            isMyTurn: status.isMyTurn,
          },
          settlement: { mode: config.settlement.mode, network: settlement.network },
          resources: resources(),
          limits,
        };
      });

      // Live Proof-of-Contribution status for the signed-in operator's node — score, live peers,
      // reward wallet balance, and projected per-epoch payout. Read-only; any signed-in operator.
      http.get('/operator/contribution', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        return contributionSummary();
      });

      // --- operator locations (the Network map's real geography) -----------------------------
      const loadLocations = async () =>
        (await ctx.store.loadSetting<NodeLocation[]>(LOCATIONS_KEY)) ?? [];

      // Public: every opt-in operator position (this is what the map renders). We merge two sources:
      // (1) locations saved on THIS node's store, and (2) locations advertised by OTHER live nodes in
      // their signed contribution heartbeats — so a remote peer (e.g. a desktop node) shows on the
      // map here, not only on its own console. De-duped by rounded coordinates.
      http.get('/operator/locations', async () => {
        const local = await loadLocations();
        const seen = new Set(local.map((l) => `${l.lat.toFixed(2)},${l.lon.toFixed(2)}`));
        const remote: NodeLocation[] = [];
        for (const r of ctx.contribution.live()) {
          if (r.nodeKey === ctx.nodePublicKey) continue; // our own dot comes from `local`
          if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
          const key = `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          remote.push({
            address: `node:${r.nodeKey.slice(0, 10)}`,
            label: (r.label || 'node').slice(0, 48),
            lat: r.lat,
            lon: r.lon,
            updatedAt: new Date(r.ts).toISOString(),
          });
        }
        return { locations: [...local, ...remote] };
      });

      // Signed-in operators set (or update) their own position. Coordinates are rounded to 4 dp
      // (~11 m) and only what is explicitly saved here is ever shared.
      http.put('/operator/location', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in to set a node location' });
        const body = (request.body ?? {}) as { lat?: number; lon?: number; label?: string };
        const lat = Number(body.lat);
        const lon = Number(body.lon);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
          return reply.code(400).send({ error: 'lat must be a number in [-90, 90]' });
        }
        if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
          return reply.code(400).send({ error: 'lon must be a number in [-180, 180]' });
        }
        const loc: NodeLocation = {
          address: acct.address,
          label: String(body.label ?? '')
            .trim()
            .slice(0, 48),
          lat: Math.round(lat * 10000) / 10000,
          lon: Math.round(lon * 10000) / 10000,
          updatedAt: new Date().toISOString(),
        };
        const rest = (await loadLocations()).filter((l) => l.address !== acct.address);
        await ctx.store.saveSetting(LOCATIONS_KEY, [...rest, loc]);
        return loc;
      });

      // --- storage settings (GUI-owned persistence config) --------------------------------------
      // Saved to the node's local config file (WEB3_CONFIG_PATH); applied on next start. The URI is
      // never echoed back in full.
      http.get('/operator/storage', async (request, reply) => {
        if (!requireRole(request, reply, ctx.accounts, 'admin')) return;
        const uri = ctx.config.mongodbUri ?? '';
        return {
          kind: ctx.store.kind,
          mongodbDb: ctx.config.mongodbDb,
          mongodbUriHint: uri ? `${uri.slice(0, 14)}…${uri.slice(-8)}` : null,
          configPath: CONFIG_FILE_PATH || null,
          note:
            ctx.store.kind === 'mongodb'
              ? 'persistent — state survives restarts'
              : 'in-memory — state is lost on restart; save a MongoDB URI to persist',
        };
      });

      http.post('/operator/storage', async (request, reply) => {
        if (!requireRole(request, reply, ctx.accounts, 'admin')) return;
        if (!CONFIG_FILE_PATH) {
          return reply.code(400).send({
            error:
              'no config file location — start the node with WEB3_CONFIG_PATH (the desktop app sets this automatically)',
          });
        }
        const body = (request.body ?? {}) as { mongodbUri?: string; mongodbDb?: string };
        const uri = String(body.mongodbUri ?? '').trim();
        if (uri && !/^mongodb(\+srv)?:\/\//.test(uri)) {
          return reply
            .code(400)
            .send({ error: 'mongodbUri must start with mongodb:// or mongodb+srv://' });
        }
        const current = existsSync(CONFIG_FILE_PATH)
          ? (JSON.parse(readFileSync(CONFIG_FILE_PATH, 'utf8')) as Record<string, unknown>)
          : {};
        const next = {
          ...current,
          mongodbUri: uri || undefined,
          mongodbDb: String(body.mongodbDb ?? ctx.config.mongodbDb).trim() || 'web3',
        };
        mkdirSync(dirname(CONFIG_FILE_PATH), { recursive: true });
        writeFileSync(CONFIG_FILE_PATH, `${JSON.stringify(next, null, 2)}\n`);
        return { saved: true, restartRequired: true, configPath: CONFIG_FILE_PATH };
      });

      // --- live monetary policy (GUI-owned economics) -------------------------------------------
      http.get('/operator/economics', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const e = ctx.economics.get();
        return {
          ...e,
          blockRewardFormatted: formatAmount(e.blockReward),
          authorityStakeFormatted: formatAmount(e.authorityStake),
        };
      });

      http.post('/operator/economics', async (request, reply) => {
        if (!requireRole(request, reply, ctx.accounts, 'admin')) return;
        const body = (request.body ?? {}) as Record<string, unknown>;
        const next = await ctx.economics.update(body);
        ctx.bus.emit({
          kind: 'economics.updated',
          summary: `economics updated — fee ${next.feeBps} bps · reward ${formatAmount(next.blockReward)}/block · burn ${next.burnBps} bps · stake ${formatAmount(next.authorityStake)}`,
        });
        return next;
      });

      // Collect node earnings: sweep the treasury (fees + block rewards) into the node owner's
      // account wallet — the wallet staking draws from. Admin-gated: the treasury belongs to
      // whoever runs the node, and on your own node the first signup bootstraps as admin.
      http.post('/operator/collect', async (request, reply) => {
        if (!requireRole(request, reply, ctx.accounts, 'admin')) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in to collect' });
        const balance = ledger.balanceOf(treasuryId as Web3Id);
        const body = (request.body ?? {}) as { amount?: number };
        // Sweep the node treasury (fees + block rewards), honouring an optional partial amount.
        const treasuryAmount = Math.min(Math.round(Number(body.amount ?? balance)), balance);
        // Always also sweep this node's contribution-reward wallet in full — it's the same owner.
        const rewardBalance = ledger.balanceOf(rewardWalletId);
        if ((!Number.isFinite(treasuryAmount) || treasuryAmount <= 0) && rewardBalance <= 0) {
          return reply.code(400).send({ error: 'nothing to collect' });
        }
        try {
          if (treasuryAmount > 0) {
            ledger.transfer(treasuryId as Web3Id, acct.address as Web3Id, treasuryAmount, {
              memo: 'operator-collect',
            });
          }
          if (rewardBalance > 0) {
            ledger.transfer(rewardWalletId, acct.address as Web3Id, rewardBalance, {
              memo: 'contribution-collect',
            });
          }
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
        const collected = Math.max(0, treasuryAmount) + rewardBalance;
        return {
          collected,
          collectedFormatted: formatAmount(collected),
          fromTreasury: Math.max(0, treasuryAmount),
          fromContribution: rewardBalance,
          walletBalance: ledger.balanceOf(acct.address as Web3Id),
        };
      });

      // --- permissionless staking (Ethereum-style authority admission) --------------------------
      // Stake aETH from your account wallet into the on-ledger escrow; once the total for a node
      // key meets the threshold, the network seats it automatically — no admin in the loop.

      http.get('/operator/stake', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        await processExits(); // land any matured refunds before reporting balances
        const acct = currentAccount(request, ctx.accounts);
        const key = ((request.query as { key?: string }).key ?? ctx.nodePublicKey).trim();
        const staked = consensus.stakeOf(key);
        const threshold = ctx.economics.authorityStake;
        return {
          threshold,
          thresholdFormatted: formatAmount(threshold),
          escrow: STAKE_ESCROW_ID,
          nodePublicKey: key,
          staked,
          stakedFormatted: formatAmount(staked),
          eligible: threshold > 0 && staked >= threshold,
          isAuthority: consensus.status().authorities.includes(key),
          walletBalance: acct ? ledger.balanceOf(acct.address as Web3Id) : 0,
        };
      });

      http.post('/operator/stake', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in to stake' });
        const body = (request.body ?? {}) as { amount?: number; nodePublicKey?: string };
        const key = String(body.nodePublicKey ?? ctx.nodePublicKey).trim();
        if (key.length < 32) {
          return reply.code(400).send({ error: 'nodePublicKey is not a plausible authority key' });
        }
        const threshold = ctx.economics.authorityStake;
        const already = consensus.stakeOf(key);
        // Default: stake exactly what's still missing to reach the threshold.
        const amount = Math.round(Number(body.amount ?? Math.max(0, threshold - already)));
        if (!Number.isFinite(amount) || amount <= 0) {
          return reply.code(400).send({ error: 'amount must be a positive number (minor units)' });
        }
        try {
          ledger.transfer(acct.address as Web3Id, STAKE_ESCROW_ID as Web3Id, amount, {
            memo: `${STAKE_MEMO_PREFIX}${key}`,
          });
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
        const staked = consensus.stakeOf(key);
        const eligible = threshold > 0 && staked >= threshold;
        ctx.bus.emit({
          kind: 'authority.staked',
          summary: `${acct.address} staked ${formatAmount(amount)} for ${key.slice(0, 16)}… (${formatAmount(staked)} total${eligible ? ' — eligible, seating on-chain' : ''})`,
        });
        return reply.code(201).send({
          staked,
          stakedFormatted: formatAmount(staked),
          threshold,
          eligible,
          note: eligible
            ? 'stake threshold met — the network seats this key in an upcoming block automatically'
            : `staked — ${formatAmount(threshold - staked)} more to reach the threshold`,
        });
      });

      // --- voluntary exit (unstake with cooldown) -----------------------------------------------
      const loadExits = async () => (await ctx.store.loadSetting<PendingExit[]>(EXITS_KEY)) ?? [];

      // Refund every exit whose cooldown has matured (escrow → staker, on the ledger).
      const processExits = async (): Promise<void> => {
        const exits = await loadExits();
        if (exits.length === 0) return;
        const now = Date.now();
        const remaining: PendingExit[] = [];
        for (const exit of exits) {
          if (Date.parse(exit.availableAt) > now) {
            remaining.push(exit);
            continue;
          }
          ledger.transfer(STAKE_ESCROW_ID as Web3Id, exit.address as Web3Id, exit.amount, {
            memo: `${UNSTAKE_MEMO_PREFIX}${exit.nodePublicKey}`,
          });
          ctx.bus.emit({
            kind: 'authority.exited',
            summary: `${exit.address} unstaked ${formatAmount(exit.amount)} (cooldown complete)`,
          });
        }
        await ctx.store.saveSetting(EXITS_KEY, remaining);
      };

      // How much of the escrowed stake for `key` this account contributed (in minus refunds out).
      const contributedStake = (address: string, key: string): number => {
        let total = 0;
        for (const e of ledger.all()) {
          if (e.type !== 'payment') continue;
          const d = e.data as { from?: string | null; to?: string; amount?: number; memo?: string };
          if (
            d.from === address &&
            d.to === STAKE_ESCROW_ID &&
            d.memo === `${STAKE_MEMO_PREFIX}${key}`
          )
            total += d.amount ?? 0;
          if (
            d.from === STAKE_ESCROW_ID &&
            d.to === address &&
            d.memo === `${UNSTAKE_MEMO_PREFIX}${key}`
          )
            total -= d.amount ?? 0;
        }
        return Math.max(0, total);
      };

      // Request an exit: the node key leaves the authority set on-chain now; the stake refund
      // matures after the cooldown (Ethereum-style exit-then-withdraw).
      http.post('/operator/unstake', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in to unstake' });
        await processExits();
        const body = (request.body ?? {}) as { nodePublicKey?: string };
        const key = String(body.nodePublicKey ?? ctx.nodePublicKey).trim();
        const pendingMine = (await loadExits()).filter(
          (x) => x.address === acct.address && x.nodePublicKey === key,
        );
        const pendingAmount = pendingMine.reduce((s, x) => s + x.amount, 0);
        const amount = contributedStake(acct.address, key) - pendingAmount;
        if (amount <= 0) {
          return reply.code(400).send({ error: 'no stake of yours to withdraw for that key' });
        }
        const cooldown = ctx.config.unstakeCooldownMs;
        const exit: PendingExit = {
          address: acct.address,
          nodePublicKey: key,
          amount,
          requestedAt: ctx.clock(),
          availableAt: new Date(Date.now() + cooldown).toISOString(),
        };
        await ctx.store.saveSetting(EXITS_KEY, [...(await loadExits()), exit]);
        // Leaving the validator set is immediate — the refund is what waits.
        const removed = consensus.queueRemoval(key);
        ctx.bus.emit({
          kind: 'authority.exited',
          summary: `${acct.address} requested exit for ${key.slice(0, 16)}… — ${formatAmount(amount)} refunds after cooldown${removed ? '; authority removal queued on-chain' : ''}`,
        });
        await processExits(); // zero-cooldown configs refund immediately
        return reply.code(201).send({ ...exit, removalQueued: removed, cooldownMs: cooldown });
      });

      // --- authority approvals (relay → authority is admin-gated governance) --------------------
      const loadRequests = async () =>
        (await ctx.store.loadSetting<AuthorityRequest[]>(AUTHORITY_REQUESTS_KEY)) ?? [];

      // A signed-in operator asks to join the authority set. One request per account; a rejected
      // request may be re-submitted. The node's own key is the default candidate key.
      http.post('/operator/authority/request', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in to request authority status' });
        const body = (request.body ?? {}) as { nodePublicKey?: string };
        const key = String(body.nodePublicKey ?? ctx.nodePublicKey).trim();
        if (!key) return reply.code(400).send({ error: 'nodePublicKey required' });
        const all = await loadRequests();
        const existing = all.find((r) => r.address === acct.address);
        if (existing?.status === 'pending') {
          return reply.code(400).send({ error: 'you already have a pending request' });
        }
        if (existing?.status === 'approved') {
          return reply.code(400).send({ error: 'already approved — the admin has your key' });
        }
        const req: AuthorityRequest = {
          address: acct.address,
          nodePublicKey: key,
          requestedAt: ctx.clock(),
          status: 'pending',
        };
        await ctx.store.saveSetting(AUTHORITY_REQUESTS_KEY, [
          ...all.filter((r) => r.address !== acct.address),
          req,
        ]);
        ctx.bus.emit({
          kind: 'authority.requested',
          summary: `${acct.address} requested authority status`,
        });
        return reply.code(201).send(req);
      });

      // Your own request's status (any signed-in account).
      http.get('/operator/authority/mine', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        const mine = acct
          ? ((await loadRequests()).find((r) => r.address === acct.address) ?? null)
          : null;
        return { request: mine };
      });

      // Admin: the full queue, and approve / reject decisions.
      http.get('/operator/authority/requests', async (request, reply) => {
        if (!requireRole(request, reply, ctx.accounts, 'admin')) return;
        return { requests: await loadRequests() };
      });

      http.post('/operator/authority/decide', async (request, reply) => {
        if (!requireRole(request, reply, ctx.accounts, 'admin')) return;
        const body = (request.body ?? {}) as { address?: string; action?: string };
        const action = body.action;
        if (action !== 'approve' && action !== 'reject') {
          return reply.code(400).send({ error: "action must be 'approve' or 'reject'" });
        }
        const all = await loadRequests();
        const target = all.find((r) => r.address === body.address);
        if (!target) return reply.code(404).send({ error: 'no request from that address' });
        const admin = currentAccount(request, ctx.accounts);
        target.status = action === 'approve' ? 'approved' : 'rejected';
        target.decidedAt = ctx.clock();
        target.decidedBy = admin?.address ?? 'admin-token';
        await ctx.store.saveSetting(AUTHORITY_REQUESTS_KEY, all);
        // Approval SEATS the authority on-chain: the key rides in the next block this node
        // proposes and every node applies the membership change — no restarts, no config edits.
        const seat =
          action === 'approve'
            ? consensus.seatAuthority(target.nodePublicKey)
            : { seated: false, note: 'rejected' };
        ctx.bus.emit({
          kind: 'authority.decided',
          summary:
            action === 'approve'
              ? `authority request from ${target.address} approved — ${seat.note}`
              : `authority request from ${target.address} rejected`,
        });
        return { ...target, seated: seat.seated, seatNote: seat.note };
      });

      // Remove your own position from the map.
      http.delete('/operator/location', async (request, reply) => {
        if (!requireAuthed(request, reply, ctx.accounts)) return;
        const acct = currentAccount(request, ctx.accounts);
        if (!acct) return reply.code(401).send({ error: 'sign in first' });
        const rest = (await loadLocations()).filter((l) => l.address !== acct.address);
        await ctx.store.saveSetting(LOCATIONS_KEY, rest);
        return { removed: true };
      });

      http.post('/node/limits', async (request, reply) => {
        if (!checkAdmin(request, reply)) return;
        const body = (request.body ?? {}) as Partial<NodeLimits>;
        const current = (await ctx.store.loadSetting<NodeLimits>(LIMITS_KEY)) ?? DEFAULT_LIMITS;
        const next: NodeLimits = {
          contribute: typeof body.contribute === 'boolean' ? body.contribute : current.contribute,
          maxRamMb: Number.isFinite(body.maxRamMb)
            ? Math.max(0, Number(body.maxRamMb))
            : current.maxRamMb,
          maxAgents: Number.isFinite(body.maxAgents)
            ? Math.max(0, Number(body.maxAgents))
            : current.maxAgents,
        };
        await ctx.store.saveSetting(LIMITS_KEY, next);
        return next;
      });
    },
  };
}
