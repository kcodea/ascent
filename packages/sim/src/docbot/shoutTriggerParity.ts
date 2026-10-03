/**
 * DOC BOT — the SHOUT-TRIGGER PARITY lane (R-SHOUT-TRIGGER-01), shared by `shoutTriggerParity.test.ts` and the
 * `npm run docbot` CLI.
 *
 * THE MISS THIS ENCODES (owner report 2026-10-03: "auctioneer w/ rune of the choir does not work and it should").
 * Rune of the Choir's "your Shouts trigger an additional time" lived in ONE counter, `playedShoutRepeats` (a Shout
 * PLAYED from hand). The Auctioneer's Pulse re-fires a Shout through `replayBattlecry`, which read Drakko but not
 * the Choir; combat never received the Choir at all; and three forced combat Shouts (Shared Scripture, Ancestral
 * Roar, War Chorus) looped the onPlay factories by hand and read none of the Shout extras. Each site had decided
 * for itself which multipliers count, so a multiplier added to one counter silently skipped the others. The
 * interaction matrix even PINNED the gap as deliberate (its P2), on the strength of a code comment.
 *
 * The lane asks, from SOURCE, the question nobody asked: DOES EVERY SITE THAT FIRES A SHOUT READ THE SHOUT EXTRAS?
 *   · SHOP: every `RECRUIT_FACTORIES` dispatch whose enclosing scope gates on `'onPlay'` is derived and must be
 *     classified in `SHOP_SHOUT_FIRE_SCOPES`. A `played` scope must read `playedShoutRepeats`, a `triggered`
 *     scope `standingShoutExtras` (the shared fold), and a `settle` scope must say why it reads neither.
 *   · COMBAT: every `FACTORIES` dispatch gated on `onPlay` (from the firePaths scan) must read
 *     `shoutCarryExtras` in its scope, the one combat fold for Choir / Encore / War Drum / Warm Embers.
 * An unclassified site, a stale entry, or a site that does not read its fold is a finding. The behavioural half
 * (each entry path really doubles under a standing +1) lives in the test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enclosingScope, scanFireSites } from './firePaths';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

export const SHOP_SHOUT_FILES = [
  'packages/sim/src/recruit.ts',
  'packages/sim/src/reducer.ts',
  'packages/sim/src/ancients.ts',
] as const;

export type ShoutCounter = 'played' | 'triggered' | 'settle';

/** Every shop scope that dispatches a Shout's `onPlay` recruit factory, and which counter it folds. */
export const SHOP_SHOUT_FIRE_SCOPES: Readonly<Record<string, { counter: ShoutCounter; why: string }>> = {
  playCard: { counter: 'played', why: 'a Shout played from hand: playedShoutRepeats (Drakko + standing extras + the per-turn charges)' },
  applyBattlecryTarget: { counter: 'played', why: 'an aimed Shout resolving after its target pick: the same played counter' },
  triggerBorrowedEcho: { counter: 'played', why: 'Funeral on Loan PLAYS the borrowed card (owner 2026-07-24): the played counter, charges included' },
  replayBattlecry: { counter: 'triggered', why: 'THE shared shop re-trigger (Auctioneer Pulse, Echoing Roar, Resonance, Ryme in the shop, Last Word, Crucible Choir, Moira): Drakko + standingShoutExtras' },
  replayEconomyBattlecry: { counter: 'settle', why: "the settle half of a COMBAT Shout fire: called once per fire the combat loop already counted (Choir / Encore / War Drum extras included via shoutCarryExtras), so folding extras here would pay them twice" },
};

const SHOP_COUNTER_READS: Record<ShoutCounter, RegExp | null> = {
  played: /\bplayedShoutRepeats\(/,
  triggered: /\bstandingShoutExtras\(/,
  settle: null,
};

const COMBAT_FOLD = /\bshoutCarryExtras\b/;

export interface ShoutFireSite { key: string; scope: string; file: string; line: number; reads: boolean }

/** The text of the enclosing scope from its declaration line down to the site. */
function scopeBody(lines: readonly string[], at: number, scope: string): string {
  if (!/^\w+$/.test(scope)) return lines.slice(Math.max(0, at - 40), at + 1).join('\n'); // top level / unnamed
  const siteIndent = /^(\s*)/.exec(lines[at]!)![1]!.length;
  const decl = new RegExp(`\\b${scope}\\b\\s*[:=(<]|function\\s+${scope}\\b`);
  for (let j = at; j >= 0; j--) {
    const l = lines[j]!;
    if (/^\s*(\/\/|\*)/.test(l)) continue;
    if (/^(\s*)/.exec(l)![1]!.length < siteIndent && decl.test(l)) return lines.slice(j, at + 1).join('\n');
  }
  return lines.slice(Math.max(0, at - 40), at + 1).join('\n');
}

/** Shop: every RECRUIT_FACTORIES dispatch inside a scope that gates on 'onPlay'. */
export function scanShopShoutSites(): ShoutFireSite[] {
  const out: ShoutFireSite[] = [];
  for (const rel of SHOP_SHOUT_FILES) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!;
      if (/^\s*(\/\/|\*)/.test(t) || !/\bRECRUIT_FACTORIES\[/.test(t)) continue;
      const scope = enclosingScope(lines, i);
      const body = scopeBody(lines, i, scope);
      if (!/'onPlay'/.test(body)) continue;
      const counter = SHOP_SHOUT_FIRE_SCOPES[scope]?.counter;
      const re = counter ? SHOP_COUNTER_READS[counter] : undefined;
      out.push({ key: scope, scope, file: rel, line: i + 1, reads: re === null ? true : !!re && re.test(body) });
    }
  }
  return out;
}

/** Combat: every FACTORIES dispatch gated on onPlay (the firePaths scan), and whether its scope reads the fold. */
export function scanCombatShoutSites(): ShoutFireSite[] {
  const cache = new Map<string, string[]>();
  return scanFireSites().filter((s) => s.trigger === 'onPlay').map((s) => {
    const lines = cache.get(s.file) ?? readFileSync(join(ROOT, s.file), 'utf8').split('\n');
    cache.set(s.file, lines);
    return { key: s.key, scope: s.enclosing, file: s.file, line: s.line, reads: COMBAT_FOLD.test(scopeBody(lines, s.line - 1, s.enclosing)) };
  });
}

export interface ShoutParityAudit {
  shop: ShoutFireSite[];
  combat: ShoutFireSite[];
  /** Shop Shout scopes with no SHOP_SHOUT_FIRE_SCOPES entry — "classify me". */
  unclassified: ShoutFireSite[];
  /** Registry entries no scanned scope matches — rot. */
  stale: string[];
  /** Sites that fire a Shout without reading their phase's Shout-extras fold — the Choir class. */
  deaf: ShoutFireSite[];
}

export function auditShoutParity(): ShoutParityAudit {
  const shop = scanShopShoutSites();
  const combat = scanCombatShoutSites();
  const seen = new Set(shop.map((s) => s.scope));
  return {
    shop,
    combat,
    unclassified: shop.filter((s) => !SHOP_SHOUT_FIRE_SCOPES[s.scope]),
    stale: Object.keys(SHOP_SHOUT_FIRE_SCOPES).filter((k) => !seen.has(k)),
    deaf: [...shop.filter((s) => SHOP_SHOUT_FIRE_SCOPES[s.scope] && !s.reads), ...combat.filter((s) => !s.reads)],
  };
}
