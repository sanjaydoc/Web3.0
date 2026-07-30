/** Tiny base64(url-safe-tolerant) <-> JSON codec used to (de)serialise x402 headers. */

const toB64 = (bytes: Uint8Array): string => {
  // Prefer Buffer (Node) but fall back to btoa for other runtimes.
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const fromB64 = (s: string): Uint8Array => {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(norm, 'base64'));
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export function jsonToB64(value: unknown): string {
  return toB64(new TextEncoder().encode(JSON.stringify(value)));
}

export function b64ToJson<T>(b64: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(fromB64(b64))) as T;
  } catch {
    return null;
  }
}
