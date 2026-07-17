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
  resolve(here, '../../../.env'), // repo root, from services/acp-node/src
];
for (const path of candidates) {
  if (existsSync(path)) {
    config({ path });
    break;
  }
}
