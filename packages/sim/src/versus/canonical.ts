/**
 * VERSUS — canonical JSON + a stable digest, shared by the client, the Node parity tool and the Edge Function
 * bundle (2026-10-13). The resolver's parity proof compares THESE strings, so both runtimes must produce the
 * same bytes for the same value: keys sorted, `undefined` dropped (an absent key and an explicit undefined are
 * the same value, exactly as `JSON.stringify` and the content revision treat them), arrays in order.
 *
 * Dependency-free on purpose: it rides the Deno bundle.
 */

/** Stable JSON: sorted keys, `undefined` members dropped, `-0` and `0` the same (as `JSON.stringify`). */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== 'function')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * A 64-bit digest as 16 lowercase hex chars: two independent FNV-1a lanes over the UTF-16 code units. Not
 * cryptographic. It only has to make "the bytes differ" visible in one short string; the parity tool still
 * compares the full canonical text when the digests disagree.
 */
export function digestOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** `digestOf(canonicalJson(value))`. */
export function canonicalDigest(value: unknown): string {
  return digestOf(canonicalJson(value));
}
