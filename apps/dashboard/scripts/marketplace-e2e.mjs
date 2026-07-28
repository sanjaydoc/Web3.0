import { utf8ToBytes } from '@noble/hashes/utils.js';
// End-to-end proof for the hosting marketplace, run against a LIVE node over HTTP.
//
// It signs lease mandates with the exact primitives the dashboard uses (see ../src/txsign.ts:
// @noble/post-quantum ML-DSA-65 over deep-sorted-JSON canonicalisation), so a mandate signed here
// verifies byte-for-byte in the node — the same path a real browser takes. Nothing is mocked.
//
// Usage:
//   1. start a fresh node:  pnpm --filter @web3/node dev
//   2. run this:            pnpm --filter @web3/dashboard e2e:marketplace
//
// A fresh (empty) node is required: the first account bootstraps as admin, which this script needs
// to set node capacity and trigger billing. Exit code is non-zero if any check fails.
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { base64urlnopad } from '@scure/base';

const BASE = process.env.WEB3_URL || 'http://127.0.0.1:8787';
const SUFFIX = String(Date.now()).slice(-6); // unique account locals so re-runs don't collide

const toB64u = (b) => base64urlnopad.encode(b);

// Deep-sorted JSON — identical to txsign.ts canonicalize() and @web3/crypto's canonicalize().
const sortDeep = (v) => {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortDeep(v[k])]),
    );
  }
  return v;
};
const canonicalize = (v) => JSON.stringify(sortDeep(v));

const genKey = () => {
  const seed = ml_dsa65.keygen();
  return { publicKey: toB64u(seed.publicKey), secretKey: seed.secretKey };
};

const signMandate = (key, body) => {
  const ordered = {
    owner: body.owner,
    host: body.host,
    agentId: body.agentId,
    maxPerEpoch: body.maxPerEpoch,
    maxEpochs: body.maxEpochs,
    expiry: body.expiry,
    nonce: body.nonce,
  };
  const signature = toB64u(ml_dsa65.sign(utf8ToBytes(canonicalize(ordered)), key.secretKey));
  return { ...ordered, pubkey: key.publicKey, signature };
};

const call = async (path, { method = 'GET', token, body } = {}) => {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const signup = async (local, role, key) => {
  const res = await call('/accounts/signup', {
    method: 'POST',
    body: { local, role, pubkey: key.publicKey },
  });
  return res.data;
};

const balanceOf = async (address) => {
  const res = await call(`/wallets/${encodeURIComponent(address)}`);
  return res.data?.wallet?.balance ?? 0;
};

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  const mark = ok ? '  ✅' : '  ❌';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  if (ok) passed += 1;
  else failed += 1;
};

const main = async () => {
  const reachable = await call('/stats').then(
    (r) => r.status === 200,
    () => false,
  );
  if (!reachable) {
    console.error(`\nNo node at ${BASE}. Start one first: pnpm --filter @web3/node dev\n`);
    process.exit(2);
  }

  console.log('\n═══ Hosting Marketplace — live end-to-end ═══\n');

  // Personas — admin bootstraps first (needed to set capacity + trigger billing).
  const adminKey = genKey();
  const hostKey = genKey();
  const ownerKey = genKey();
  const admin = await signup(`e2eadmin${SUFFIX}`, 'admin', adminKey);
  const host = await signup(`e2ehost${SUFFIX}`, 'operator', hostKey);
  const owner = await signup(`e2eowner${SUFFIX}`, 'agent-owner', ownerKey);
  console.log('Personas:');
  check('admin bootstraps as admin', admin.role === 'admin', admin.address);
  check('operator persona', host.role === 'operator', host.address);
  check('agent-owner persona', owner.role === 'agent-owner', owner.address);
  const me = await call('/accounts/me', { token: owner.token });
  check('agent-owner starts on the free plan', me.data.plan === 'free');

  // RAM -> real capacity (2048 MB / 256 MB-per-agent = 8 agents).
  const limits = await call('/node/limits', {
    method: 'POST',
    token: admin.token,
    body: { contribute: true, maxRamMb: 2048 },
  });
  check(
    'RAM derives capacity (2048 MB → 8 agents)',
    limits.data.maxAgents === 8,
    `maxAgents=${limits.data.maxAgents}`,
  );

  // Host publishes a per-epoch price -> becomes the marketplace host.
  const price = 500; // 5.00 aETH / epoch
  await call('/hosting/offer', {
    method: 'POST',
    token: host.token,
    body: { pricePerEpoch: price },
  });
  const market = await call('/hosting/market');
  const listing = market.data.hosts.find((h) => h.host === host.address);
  console.log('\nMarketplace:');
  check(
    'offer appears in the market',
    Boolean(listing),
    listing && `${listing.host} @ ${listing.pricePerEpoch}`,
  );
  check(
    'free capacity advertised',
    listing && listing.free === 8,
    listing && `free=${listing.free}/${listing.capacity}`,
  );

  // Owner rents with a signed ML-DSA lease mandate.
  const agentId = `shopbot${SUFFIX}@web3.0`;
  const nonce = toB64u(ml_dsa65.keygen().publicKey.slice(0, 12));
  const mandate = signMandate(ownerKey, {
    owner: owner.address,
    host: host.address,
    agentId,
    maxPerEpoch: price,
    maxEpochs: 0,
    expiry: '',
    nonce,
  });
  const rent = await call('/hosting/rent', {
    method: 'POST',
    token: owner.token,
    body: { agentId, mandate },
  });
  console.log('\nSigned lease:');
  check(
    'rent succeeds with a signed mandate',
    rent.status === 200,
    `lease ${rent.data.id ?? rent.data.error}`,
  );
  check(
    'lease is mandate-backed',
    Boolean(rent.data.mandate),
    rent.data.mandate ? 'signature attached' : 'unsigned',
  );
  const leaseId = rent.data.id;

  // A tampered signature must be refused.
  const forged = signMandate(ownerKey, {
    owner: owner.address,
    host: host.address,
    agentId: `evil${SUFFIX}@web3.0`,
    maxPerEpoch: 1,
    maxEpochs: 0,
    expiry: '',
    nonce: 'tampered0',
  });
  forged.signature = `${forged.signature.slice(0, -4)}AAAA`;
  const badRent = await call('/hosting/rent', {
    method: 'POST',
    token: owner.token,
    body: { agentId: `evil${SUFFIX}@web3.0`, mandate: forged },
  });
  check(
    'forged signature rejected',
    badRent.status === 400,
    badRent.data.error || `status ${badRent.status}`,
  );

  // Bill one epoch -> 3% commission, 1/1/1 split, zero minting.
  const ownerBefore = await balanceOf(owner.address);
  const hostBefore = await balanceOf(host.address);
  const bill = await call('/hosting/bill', { method: 'POST', token: admin.token });
  const receipt = (bill.data.receipts || []).find((r) => r.leaseId === leaseId);
  const ownerAfter = await balanceOf(owner.address);
  const hostAfter = await balanceOf(host.address);
  console.log('\nBilling + 3% commission (1/1/1 split, no minting):');
  check(
    'epoch produced a receipt',
    Boolean(receipt),
    receipt && `gross=${receipt.gross} commission=${receipt.commission} net=${receipt.net}`,
  );
  if (receipt) {
    const expectedCommission = Math.floor((price * 300) / 10_000); // 3%
    const nodeThird = Math.floor(receipt.commission / 3); // the serving node's 1/3 slice
    check(
      'commission is 3% of gross',
      receipt.commission === expectedCommission,
      `commission=${receipt.commission} (expected ${expectedCommission})`,
    );
    check(
      'net = gross − commission',
      receipt.net === receipt.gross - receipt.commission,
      `${receipt.net} = ${receipt.gross} − ${receipt.commission}`,
    );
    check(
      'owner charged exactly gross',
      ownerBefore - ownerAfter === receipt.gross,
      `Δowner=${ownerBefore - ownerAfter}`,
    );
    check(
      'host earns net + its ⅓ commission slice',
      hostAfter - hostBefore === receipt.net + nodeThird,
      `Δhost=${hostAfter - hostBefore} (net ${receipt.net} + ${nodeThird})`,
    );
    check(
      'no minting: owner debit = host credit + treasury',
      ownerBefore - ownerAfter === hostAfter - hostBefore + (receipt.commission - nodeThird),
      `${ownerBefore - ownerAfter} = ${hostAfter - hostBefore} + ${receipt.commission - nodeThird}`,
    );
  }
  const leases = await call('/hosting/leases', { token: admin.token });
  const leaseNow = (leases.data.leases || []).find((l) => l.id === leaseId);
  check(
    'lease epoch counter advanced',
    leaseNow && leaseNow.epochsBilled === 1,
    leaseNow && `epochsBilled=${leaseNow.epochsBilled}`,
  );

  // Owner ends the lease.
  const ended = await call(`/hosting/lease/${leaseId}/end`, { method: 'POST', token: owner.token });
  check('owner can end their lease', ended.data.ended === true);

  console.log(`\n═══ ${passed} passed, ${failed} failed ═══\n`);
  process.exit(failed ? 1 : 0);
};

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
