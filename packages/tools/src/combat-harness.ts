/**
 * Headless combat harness (handoff M0). Resolves a fixed matchup, prints the
 * narrated event log, and proves determinism by re-running the same seed and
 * comparing byte-for-byte. Run with: `npm run harness`.
 */
import { simulate, makeRng, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, validateCards } from '@game/content';

validateCards();

const player: BoardMinion[] = [
  { cardId: 'kennel', attack: 2, health: 3 },
  { cardId: 'pack', attack: 2, health: 2 },
  { cardId: 'alley', attack: 2, health: 4 },
  { cardId: 'gnash', attack: 6, health: 6 },
];

const enemy: BoardMinion[] = [
  { cardId: 'sandbag', attack: 0, health: 4 },
  { cardId: 'cleric', attack: 4, health: 4 },
  { cardId: 'pack', attack: 2, health: 2 },
  { cardId: 'alley', attack: 1, health: 1 },
];

const SEED = 0xa5ce47;

type Result = ReturnType<typeof simulate>;

function nameMap(result: Result): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of [...result.initial.player, ...result.initial.enemy]) map.set(m.uid, m.name);
  for (const ev of result.events) if (ev.type === 'summon') map.set(ev.minion.uid, ev.minion.name);
  return map;
}

function describe(ev: CombatEvent, names: Map<string, string>): string {
  const n = (uid: string): string => names.get(uid) ?? uid;
  switch (ev.type) {
    case 'sc':
      return `  ⚡ ${ev.text}`;
    case 'attack':
      return `→ ${n(ev.attacker)} attacks ${n(ev.defender)}${ev.swing > 0 ? ' (windfury)' : ''}`;
    case 'dmg':
      return `   ${n(ev.target)} takes ${ev.amount}  (${ev.remainingHp} hp left)`;
    case 'shield':
      return `   ◇ ${n(ev.target)}'s Divine Shield absorbs it`;
    case 'shieldUp':
      return `   ◇ ${n(ev.target)} gains a Divine Shield`;
    case 'poison':
      return `   ☠ ${n(ev.target)} is destroyed by Venomous`;
    case 'reborn':
      return `   ♻ ${n(ev.target)} is Reborn at 1 hp`;
    case 'death':
      return `   † ${n(ev.target)} dies`;
    case 'reveal':
      return `   ◐ ${n(ev.target)} loses Stealth`;
    case 'venomLost':
      return `   ☣ ${n(ev.target)} spends its Venomous`;
    case 'summon':
      return `   + ${ev.minion.name} (${ev.minion.attack}/${ev.minion.health}) summoned on ${ev.side}`;
    case 'buff':
      return `   ↑ ${n(ev.target)} +${ev.attack}/+${ev.health}`;
    case 'improve':
      return `   ✦ ${n(ev.target)} aura +${ev.amount}/+${ev.amount}`;
    case 'maxGold':
      return `   ◉ ${n(ev.target)}'s Avenge raises max Gold +${ev.amount}`;
    case 'rally':
      return `   ☠ ${n(ev.source)}'s Rally fires ${n(ev.target)}'s Deathrattle`;
    case 'toHand':
      return `   ✋ ${CARD_INDEX[ev.cardId]?.name ?? ev.cardId} added to hand`;
    case 'hpGrant':
      return `   ✦ ${n(ev.target)} HP-grant now +${ev.amount}`;
  }
}

const board = (b: BoardMinion[]): string =>
  b.map((m) => `${CARD_INDEX[m.cardId]?.name ?? m.cardId} ${m.attack}/${m.health}`).join(', ');

const a = simulate(player, enemy, makeRng(SEED), CARD_INDEX);
const b = simulate(player, enemy, makeRng(SEED), CARD_INDEX);
const deterministic = JSON.stringify(a) === JSON.stringify(b);

const names = nameMap(a);

console.log('\n=== ASCENT — combat harness ===\n');
console.log('PLAYER:', board(player));
console.log('ENEMY: ', board(enemy));
console.log(`\n--- event log (seed 0x${SEED.toString(16)}) ---`);
for (const ev of a.events) console.log(describe(ev, names));
console.log(
  `\nRESULT: ${a.result.toUpperCase()}${a.result === 'lose' ? ` — player loses ${a.playerDamage} Resolve` : ''}`,
);
console.log(`EVENTS: ${a.events.length}`);
console.log(
  `\nDETERMINISM: re-running the same seed produced ${
    deterministic ? 'an IDENTICAL' : 'a DIFFERENT'
  } result  ${deterministic ? '✓' : '✗ — BUG'}`,
);

if (!deterministic) process.exit(1);
