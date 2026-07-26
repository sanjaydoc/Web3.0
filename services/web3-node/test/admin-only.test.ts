import { generateKeypair } from '@web3/crypto';
import { describe, expect, it } from 'vitest';
import { Kernel } from '../src/kernel.js';
import { MemoryStore } from '../src/store/index.js';

/**
 * Admin-only mode reserves the network's MAIN node for its admin: non-admins may sign up and read,
 * but launching/hosting agents (consuming the node's compute) is refused with a prompt to run their
 * own node. A normal node (adminOnly off) lets any signed-in account launch.
 */
async function bootWith(adminOnly: boolean) {
  const kernel = new Kernel({ port: 0, adminOnly }, generateKeypair(), new MemoryStore());
  await kernel.init();
  const signup = async (local: string, role: string) => {
    const res = await kernel.http.inject({
      method: 'POST',
      url: '/accounts/signup',
      payload: { local, role },
    });
    return (res.json() as { token: string }).token;
  };
  // First signup bootstraps as admin; the second is a plain developer.
  const adminToken = await signup('owner', 'admin');
  const devToken = await signup('maxdev', 'developer');
  const launch = (token: string, handle: string) =>
    kernel.http.inject({
      method: 'POST',
      url: '/hosted/launch',
      headers: { 'x-web3-token': token },
      payload: {
        handle,
        name: 'Gen',
        description: 'an agent',
        skillId: 'ask',
        skillName: 'Ask',
        skillDesc: 'answers',
        price: 100,
        provider: 'local',
        model: 'x',
        apiKey: 'k',
        system: 'be helpful',
      },
    });
  return { kernel, adminToken, devToken, launch };
}

describe('admin-only main node', () => {
  it('refuses a non-admin launch with a run-your-own-node prompt', async () => {
    const { kernel, devToken, launch } = await bootWith(true);
    const res = await launch(devToken, 'devagent');
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: string; adminOnly?: boolean };
    expect(body.adminOnly).toBe(true);
    expect(body.error).toMatch(/run your own node/i);
    await kernel.close();
  });

  it('still lets the admin launch on an admin-only node', async () => {
    const { kernel, adminToken, launch } = await bootWith(true);
    const res = await launch(adminToken, 'adminagent');
    expect(res.statusCode).not.toBe(403); // guard passed (launch itself proceeds)
    await kernel.close();
  });

  it('lets any signed-in account launch when admin-only is off', async () => {
    const { kernel, devToken, launch } = await bootWith(false);
    const res = await launch(devToken, 'openagent');
    expect(res.statusCode).not.toBe(403);
    await kernel.close();
  });

  it('exposes adminOnly on the /node payload', async () => {
    const { kernel } = await bootWith(true);
    const res = await kernel.http.inject({ method: 'GET', url: '/node' });
    const body = res.json() as { auth: { adminOnly: boolean } };
    expect(body.auth.adminOnly).toBe(true);
    await kernel.close();
  });
});
