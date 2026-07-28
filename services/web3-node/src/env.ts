import dns from 'node:dns';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

/**
 * Load a `.env` file so the node can be configured from one place. Imported FIRST in index.ts so
 * variables are set before config.ts reads them. Looks for `.env` in the current directory and at
 * the repo root; shell-exported variables still take precedence (dotenv does not override them).
 */
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(process.cwd(), '.env'),
  resolve(here, '../../../.env'), // repo root, from services/web3-node/src
];
for (const path of candidates) {
  if (existsSync(path)) {
    config({ path });
    break;
  }
}

/**
 * Force specific DNS resolvers for this process. Fixes `querySrv ECONNREFUSED` when connecting to
 * MongoDB Atlas (`mongodb+srv://`) on networks where Node can't do the SRV lookup with the system
 * resolver. Set WEB3_DNS_SERVERS=8.8.8.8,1.1.1.1 in .env.
 */
const dnsServers = (process.env.WEB3_DNS_SERVERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (dnsServers.length > 0) {
  try {
    dns.setServers(dnsServers);
  } catch (err) {
    console.warn(`WEB3_DNS_SERVERS is invalid (${dnsServers.join(', ')}):`, err);
  }
}
