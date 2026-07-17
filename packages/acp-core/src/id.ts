/**
 * A Web3.0 ID is a human-readable handle that works like an email address: `alice@acp`.
 * Every participant — human or agent — has one. It resolves to a DID (cryptographic identity)
 * and a wallet. The `@acp` namespace is the default network; more namespaces can be added as
 * modules without changing this format.
 */

export const ID_NAMESPACE = 'acp' as const;

/** A validated Web3.0 ID, e.g. `alice@acp`. */
export type Web3Id = string & { readonly __brand: 'Web3Id' };

const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/;

export interface ParsedWeb3Id {
  local: string;
  namespace: string;
}

/** Whether a string is a syntactically valid Web3.0 ID in the `@acp` namespace. */
export function isValidWeb3Id(value: string): value is Web3Id {
  const parsed = tryParse(value);
  return parsed !== null && parsed.namespace === ID_NAMESPACE;
}

/** Lower-cases and trims; does not validate. Use before validation to normalise input. */
export function normalizeWeb3Id(value: string): string {
  return value.trim().toLowerCase();
}

/** Build a Web3.0 ID from a local part, e.g. `web3Id('alice') === 'alice@acp'`. Throws if invalid. */
export function web3Id(local: string, namespace: string = ID_NAMESPACE): Web3Id {
  const candidate = `${normalizeWeb3Id(local)}@${namespace}`;
  if (!isValidWeb3Id(candidate)) {
    throw new Error(`Invalid Web3.0 ID local part: "${local}"`);
  }
  return candidate as Web3Id;
}

/** Parse a Web3.0 ID into its parts, or return null if malformed. */
export function parseWeb3Id(value: string): ParsedWeb3Id | null {
  const parsed = tryParse(value);
  return parsed && parsed.namespace === ID_NAMESPACE ? parsed : null;
}

function tryParse(value: string): ParsedWeb3Id | null {
  const normalized = normalizeWeb3Id(value);
  const at = normalized.indexOf('@');
  if (at <= 0 || at !== normalized.lastIndexOf('@')) return null;
  const local = normalized.slice(0, at);
  const namespace = normalized.slice(at + 1);
  if (!LOCAL_RE.test(local) || namespace.length === 0) return null;
  return { local, namespace };
}
