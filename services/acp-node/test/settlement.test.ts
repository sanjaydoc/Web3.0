import { describe, expect, it } from 'vitest';
import type { SettlementConfig } from '../src/config.js';
import {
  InternalSettlement,
  SimulatedSettlement,
  TestnetSettlement,
  createSettlement,
  encodeErc20Transfer,
  toTokenUnits,
} from '../src/services/settlement.js';

const base: SettlementConfig = { mode: 'internal', network: 'acp-ledger', decimals: 2 };
const intent = {
  from: 'a@web3.0',
  to: 'b@web3.0',
  amount: 1250,
  currency: 'aETH',
  reference: 'HASH',
};

describe('settlement providers', () => {
  it('createSettlement picks the provider by mode', () => {
    expect(createSettlement({ ...base, mode: 'internal' })).toBeInstanceOf(InternalSettlement);
    expect(createSettlement({ ...base, mode: 'simulated' })).toBeInstanceOf(SimulatedSettlement);
    expect(createSettlement({ ...base, mode: 'testnet' })).toBeInstanceOf(TestnetSettlement);
  });

  it('internal settlement returns the ledger reference as settled', async () => {
    const r = await new InternalSettlement().settle(intent);
    expect(r).toMatchObject({ network: 'acp-ledger', status: 'settled', txRef: 'HASH' });
  });

  it('simulated settlement is deterministic and can build an explorer link', async () => {
    const cfg = { ...base, mode: 'simulated' as const, explorerBaseUrl: 'https://sim.example' };
    const a = await new SimulatedSettlement(cfg).settle(intent);
    const b = await new SimulatedSettlement(cfg).settle(intent);
    expect(a.status).toBe('settled');
    expect(a.txRef).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.txRef).toBe(b.txRef); // deterministic for the same intent
    expect(a.explorerUrl).toBe(`https://sim.example/tx/${a.txRef}`);
  });

  it('testnet settlement prepares real ERC-20 calldata but never broadcasts', async () => {
    const cfg = {
      ...base,
      mode: 'testnet' as const,
      network: 'base-sepolia',
      tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      decimals: 6,
    };
    const r = await new TestnetSettlement(cfg).settle(intent);
    expect(r.status).toBe('pending'); // no signer → cannot broadcast, by design
    expect(r.detail).toContain('calldata=0xa9059cbb'); // real transfer(address,uint256) selector
  });

  it('testnet settlement fails cleanly without a token address', async () => {
    const r = await new TestnetSettlement({ ...base, mode: 'testnet' }).settle(intent);
    expect(r.status).toBe('failed');
  });

  it('encodes ERC-20 transfer calldata and scales minor units to token decimals', () => {
    // 12.50 aETH (1250 minor units) in a 6-decimal token → 12_500_000 base units.
    expect(toTokenUnits(1250, 6)).toBe(12_500_000n);
    const data = encodeErc20Transfer('0x00000000000000000000000000000000000000Ab', 12_500_000n);
    expect(data.slice(0, 10)).toBe('0xa9059cbb');
    expect(data).toHaveLength(2 + 8 + 64 + 64); // 0x + selector + address word + amount word
    expect(data.endsWith('bebc20')).toBe(true); // 12_500_000 = 0xbebc20
  });
});
