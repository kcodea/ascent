/** A short, stable fingerprint of a rule statement / glossary definition (FNV-1a 32-bit, 8 hex characters).
 *  Whitespace is collapsed first so re-wrapping a long statement doesn't trip the wiki tripwire. */
export function fingerprint(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
