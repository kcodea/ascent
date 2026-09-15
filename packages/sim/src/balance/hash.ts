/** A cheap, stable content hash for `StateHash` — FNV-1a over a canonical projection of the run. Presentation-
 *  free and RNG-free: two runs that differ only in FX channels hash the same. */
import type { RunState } from '../state';
import type { StateHash } from './types';

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function stateHash(run: RunState): StateHash {
  const card = (c: { uid: string; cardId: string; attack: number; health: number; golden?: boolean; keywords?: readonly string[] }) =>
    `${c.uid}:${c.cardId}:${c.attack}/${c.health}${c.golden ? 'g' : ''}[${(c.keywords ?? []).join('')}]`;
  const parts = [
    `w${run.wave}`, `t${run.tier}`, `e${run.embers}`, `h${run.resolve}`, `a${run.armor}`,
    'B' + run.board.map(card).join(','),
    'H' + run.hand.map(card).join(','),
    'S' + run.shop.map((o) => `${o.uid}:${o.cardId}:${o.atk ?? 0}/${o.hp ?? 0}${o.starform ? '*' : ''}`).join(','),
    'R' + (run.ownedRunes ?? []).join(','),
  ];
  return fnv1a(parts.join('|'));
}
