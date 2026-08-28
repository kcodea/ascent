import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { alignmentOf } from './alignment';

/**
 * SET 3 — THE CELESTIALS. Every test drives the real reducer through a `play` action, because the whole
 * tribe hangs off two things the reducer owns: WHERE a card lands (alignment) and WHAT it lands next to
 * (Orbit). A test that called the factories directly would prove nothing about either.
 */
const card = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });

/**
 * Two facts these tests learned the hard way, both real behaviour rather than quirks:
 *
 *  1. THREE copies of one card id TRIPLE into a golden. Filler must therefore use DISTINCT ids, or the board
 *     silently collapses mid-test and every stat total goes sideways.
 *  2. Alignment is read when the Orbit FIRES — i.e. AFTER the arriver has landed and re-centred the board. A
 *     lone watcher is Eclipsed only until something lands beside it, at which point a 2-board makes it Dawn.
 *     Every expectation below is written against the post-arrival board.
 */
const FILLER = ['pack', 'alley', 'stray', 'sandbag', 'pup'] as const;

/** A run with `board` seated and `hand` held, ready for a `play` that lands at `toIndex`. */
const staged = (board: BoardCard[], hand: BoardCard[]): RunState =>
  ({ ...createRun(1), phase: 'recruit', embers: 50, board, hand } as RunState);

describe('the tribe is ARCHIVED, and its mechanics still hold', () => {
  // Owner 2026-08-28: "celestials have been extremely and completely re-worked ... leaving set 3 empty of
  // minions now." The sixteen moved to the MINION ARCHIVE — out of every pool, still resolvable by id.
  it('set 3 offers no CELESTIALS', () => {
    // Set 3 is not empty — it carries the Equipment reference card — but no Celestial is drawable until the
    // rework lands.
    expect(poolFor('set3').buyable.filter((c) => c.tribe === 'celestial')).toEqual([]);
  });

  it('...but the archived Celestials still resolve, which is what keeps the tests below meaningful', () => {
    // EVERY test in this file drives real Alignment and Orbit behaviour through the reducer using these ids.
    // They keep working because an archived card is removed from PLAY, not from CARD_INDEX — so this file
    // remains the pinned specification of the two mechanics the reworked tribe will be built on.
    for (const id of ['c3_familiar', 'c3_binary', 'c3_orrery']) {
      expect(CARD_INDEX[id], `${id} must still resolve`).toBeTruthy();
      expect(CARD_INDEX[id]!.tribe, `${id} keeps its tribe`).toBe('celestial');
    }
  });
});

describe('ORBIT — fires for the neighbours of the slot you drop into', () => {
  it('pays the adjacent watcher and nobody else', () => {
    // Familiar at 0, a bystander at 1. Playing INTO index 1 puts the arriver between them, so the Familiar
    // (adjacent) fires and the bystander's non-Orbit body is merely a witness.
    let s = staged([card('fam', 'c3_familiar', 3, 1)], [card('n', 'pack', 1, 1)]);
    const before = s.board[0]!.attack + s.board[0]!.health;
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 });
    const total = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    // The arrival makes it a 2-board, so the Familiar reads DAWN when its Orbit fires — the Attack half only.
    expect(total).toBe(before + (1 + 1) + 2);
  });

  it('does NOT fire for a non-adjacent watcher', () => {
    // Familiar at 0, wall at 1, wall at 2 — playing at index 3 lands two slots away from the Familiar.
    let s = staged(
      [card('fam', 'c3_familiar', 3, 1), card('w1', 'alley', 1, 1), card('w2', 'stray', 1, 1)],
      [card('n', 'sandbag', 1, 1)],
    );
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 3 });
    expect(s.board.reduce((n, c) => n + c.attack + c.health, 0), 'only the arriver\'s own stats').toBe(before + 2);
  });
});

describe('ALIGNMENT — the same card behaves differently by seat', () => {
  it('Dawn takes the Attack half, Dusk the Health half', () => {
    // Two Channelers at the ends of a 4-board: index 0 is Dawn, index 3 is Dusk (an even board has no
    // Eclipse), so playing between them fires one Attack half and one Health half.
    let s = staged(
      [card('dawn', 'c3_channeler', 3, 8), card('mid', 'alley', 9, 9), card('dusk', 'c3_channeler', 3, 8)],
      [card('n', 'stray', 1, 1)],
    );
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 }); // lands adjacent to the Dawn Channeler only
    expect(alignmentOf(s.board, 'dawn')).toBe('dawn');
    // The lowest-Attack body took +4 Attack; nothing took +4 Health from this arrival.
    const gained = s.board.reduce((n, c) => n + c.attack, 0) - (3 + 9 + 3 + 1);
    expect(gained, 'the Dawn half fired').toBe(4);
  });

  it('an ECLIPSED body runs BOTH halves — the rule falls out of alignAllows', () => {
    // Seat 4 and insert at index 3: the board becomes 5 wide with the Channeler at index 2 — the exact
    // middle, i.e. Eclipse — and the arriver landing beside it at index 3.
    let s = staged(
      [card('a', 'pack', 5, 5), card('b', 'alley', 5, 5), card('ch', 'c3_channeler', 3, 8), card('c', 'stray', 5, 5)],
      [card('n', 'sandbag', 1, 1)],
    );
    const beforeA = s.board.reduce((n, c) => n + c.attack, 0);
    const beforeH = s.board.reduce((n, c) => n + c.health, 0);
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 3 });
    expect(alignmentOf(s.board, 'ch'), 'centred on the post-arrival board').toBe('eclipse');
    expect(s.board.reduce((n, c) => n + c.attack, 0) - beforeA - 1, 'Dawn half').toBe(4);
    expect(s.board.reduce((n, c) => n + c.health, 0) - beforeH - 1, 'Dusk half').toBe(4);
  });
});

describe('ORBIT (N) — the cadence notation', () => {
  it('pays out only on the Nth arrival, and the tick is per instance', () => {
    // Star Cartographer is Orbit (4) → three arrivals do nothing, the fourth improves Shop spells.
    let s = staged([card('sc', 'c3_cartographer', 4, 4)],
      FILLER.slice(0, 4).map((id, i) => card(`n${i + 1}`, id)));
    for (const uid of ['n1', 'n2', 'n3']) {
      s = reduce(s, { type: 'play', uid, toIndex: 1 });
      expect(s.spellBonus ?? { attack: 0, health: 0 }, `${uid} must not pay out`).toEqual({ attack: 0, health: 0 });
    }
    s = reduce(s, { type: 'play', uid: 'n4', toIndex: 1 });
    expect((s.spellBonus?.attack ?? 0) + (s.spellBonus?.health ?? 0), 'the 4th arrival pays out').toBeGreaterThan(0);
  });
});

describe('the board-wide ORBIT WATCHER is distinct from an Orbit', () => {
  it('Worldline Weaver fires off SOMEONE ELSE\'s Orbit', () => {
    // The Weaver has no Orbit of its own — it watches. Familiar at 0 orbits, Weaver sits at the far end and
    // still pays, which is exactly the difference between `orbit` and `orbitFired`.
    let s = staged(
      [card('fam', 'c3_familiar', 3, 1), card('w', 'alley', 1, 1), card('weav', 'c3_weaver', 6, 10)],
      [card('n', 'stray', 1, 1)],
    );
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 }); // adjacent to the Familiar, NOT the Weaver
    const after = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    // Familiar's own Orbit (+2 somewhere) plus the Weaver's board-wide payout — strictly more than the
    // Orbit alone would give.
    expect(after - before - 2, 'the Weaver reacted to a distant Orbit').toBeGreaterThan(2);
  });
});

describe('Binary Star multiplies its NEIGHBOURS\' Orbits', () => {
  it('an adjacent Orbit pays twice', () => {
    const play = (withBinary: boolean): number => {
      // Order matters: [multiplier, watcher] then insert at 2. Post-arrival the Familiar sits at index 1 with
      // the arriver beside it at 2 AND the multiplier still adjacent at 0. Inserting BETWEEN them would
      // separate the pair — adjacency is read after the board re-centres, which is the card's real cost.
      const board = withBinary
        ? [card('bin', 'c3_binary', 5, 8), card('fam', 'c3_familiar', 3, 1)]
        : [card('plain', 'alley', 5, 8), card('fam', 'c3_familiar', 3, 1)];
      let s = staged(board, [card('n', 'stray', 1, 1)]);
      const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
      s = reduce(s, { type: 'play', uid: 'n', toIndex: 2 });
      return s.board.reduce((n, c) => n + c.attack + c.health, 0) - before - 2; // minus the arriver itself
    };
    const plain = play(false);
    const doubled = play(true);
    expect(plain, 'the Familiar paid once').toBeGreaterThan(0);
    expect(doubled, 'Binary Star made it pay twice').toBe(plain * 2);
  });
});

describe('Starpath Vendor accrues sell value, capped', () => {
  it('grows +1 per Orbit and stops at +3', () => {
    let s = staged([card('v', 'c3_vendor', 2, 4)],
      FILLER.map((id, i) => card(`n${i + 1}`, id)));
    for (const uid of ['n1', 'n2', 'n3', 'n4', 'n5']) s = reduce(s, { type: 'play', uid, toIndex: 1 });
    const vendor = s.board.find((c) => c.uid === 'v')!;
    expect(vendor.sellBonus, 'capped at +3 however many Orbits fired').toBe(3);
  });
});

describe('Horizon Collector copies the arriver\'s bonus stats without stealing them', () => {
  it('takes what the minion carries above its printed base', () => {
    const base = CARD_INDEX['pack']!;
    let s = staged(
      [card('col', 'c3_collector', 5, 12)],
      [card('n', 'pack', base.attack + 4, base.health + 6)], // a bought-up minion: +4/+6 of bonus
    );
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 });
    const col = s.board.find((c) => c.uid === 'col')!;
    const arriver = s.board.find((c) => c.uid === 'n')!;
    // Eclipsed (lone Collector), so both halves run; the copy is at least the bonus on each axis.
    expect(col.attack).toBeGreaterThanOrEqual(5 + 4);
    expect(col.health).toBeGreaterThanOrEqual(12 + 6);
    expect([arriver.attack, arriver.health], 'the arriver keeps its own stats').toEqual([base.attack + 4, base.health + 6]);
  });
});

/** Bonus stats = everything a body carries above its PRINTED base. Computed from the card index rather than
 *  hardcoded, so a balance change to a filler card can never quietly invalidate these expectations. */
const bonusOf = (c: BoardCard): { a: number; h: number } => {
  const base = CARD_INDEX[c.cardId]!;
  return { a: Math.max(0, c.attack - base.attack), h: Math.max(0, c.health - base.health) };
};

describe('ASTRAL RELAY — an Orbit you trigger yourself, with nothing arriving', () => {
  it('the Dawn Shout fires the neighbours\' Orbits a SECOND time on the way in', () => {
    // The Relay is played at index 0 so it lands DAWN (left of centre on the resulting 2-board) and its Shout
    // half applies. The Familiar it lands beside is then index 1 = DUSK, so each fire is +2 Health. Two fires
    // are due: the arrival itself (a normal Orbit) and the Relay's triggered one.
    let s = staged([card('fam', 'c3_familiar', 3, 1)], [card('r', 'c3_relay', 5, 6)]);
    s = reduce(s, { type: 'play', uid: 'r', toIndex: 0 });
    expect(alignmentOf(s.board, 'r'), 'the Relay landed on the Dawn half').toBe('dawn');
    // The Familiar's Dusk half pays a RANDOM friend, so the board TOTAL is what pins the number of fires:
    // two of them at +2 Health each — the arrival's own Orbit, and the one the Relay's Shout triggered.
    expect(s.board.reduce((n, c) => n + c.health, 0), 'two fires of +2 Health').toBe(1 + 6 + 4);
  });

  it('a Relay seated on the DUSK half holds its Shout (the End of Turn half is the Dusk one)', () => {
    let s = staged([card('fam', 'c3_familiar', 3, 1)], [card('r', 'c3_relay', 5, 6)]);
    s = reduce(s, { type: 'play', uid: 'r', toIndex: 1 }); // lands right of centre → Dusk
    expect(alignmentOf(s.board, 'r')).toBe('dusk');
    // The Familiar is now left of centre — DAWN, so its half grants Attack — and only ONE fire is due: the
    // Relay's Shout is Dawn-gated and the Relay is seated on the Dusk half, so it stays silent.
    expect(s.board.reduce((n, c) => n + c.attack, 0), 'the arrival Orbit only').toBe(3 + 5 + 2);
  });

  it('a triggered Orbit stands down for anything that consumes the ARRIVER', () => {
    // Horizon Collector takes the arriver's bonus stats. Triggered with nothing arriving it must collect
    // nothing — in particular it must not read the stand-in body the payload carries.
    let s = staged([card('col', 'c3_collector', 5, 12)], [card('r', 'c3_relay', 5, 6)]);
    s = reduce(s, { type: 'play', uid: 'r', toIndex: 0 });
    expect(s.board.find((c) => c.uid === 'col')!.attack, 'nothing to collect').toBe(5);
  });
});

describe('CELESTIAL CRUCIBLE — paid per stack of Shop buffs on the arriver', () => {
  it('an unbuffed arrival pays nothing', () => {
    let s = staged([card('cru', 'c3_crucible', 4, 7)], [card('n', 'alley', 1, 1)]);
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 });
    expect(s.board.find((c) => c.uid === 'cru')!.attack).toBe(4);
  });

  it('pays +1/+1 per STACK — two separate buffs on the arriver, not their size', () => {
    // Deliberately lopsided amounts: what the Crucible reads is the COUNT of applications, so a +1/+1 and a
    // +9/+9 are worth the same two stacks.
    const buffed = { ...card('n', 'alley', 1, 1), buffs: [
      { source: 'Ruby', attack: 1, health: 1, count: 1 },
      { source: 'Growth', attack: 9, health: 9, count: 1 },
    ] } as BoardCard;
    let s = staged([card('cru', 'c3_crucible', 4, 7)], [buffed]);
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 });
    expect(s.board.find((c) => c.uid === 'cru')!.attack, '+1 × 2 stacks').toBe(4 + 2);
  });
});

describe('CONSTELLATION BROKER — devours the arrival and hands the investment on', () => {
  it('destroys the played minion and passes its BONUS stats to another Celestial', () => {
    // `stray` carries no Echo, so this isolates the transfer from the Echo behaviour tested below.
    const fat = card('n', 'stray', 9, 9);
    const bonus = bonusOf(fat);
    expect(bonus.a, 'the fixture really is buffed above base').toBeGreaterThan(0);
    let s = staged([card('bro', 'c3_broker', 5, 8), card('gard', 'c3_gardener', 4, 6)], [fat]);
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 });
    expect(s.board.some((c) => c.uid === 'n'), 'the arrival was devoured').toBe(false);
    // The Gardener is the only OTHER Celestial, so the whole parcel lands on it. Its own Orbit casts a spell
    // rather than granting stats, so nothing else moves its Attack.
    expect(s.board.find((c) => c.uid === 'gard')!.attack, 'inherited the bonus Attack').toBe(4 + bonus.a);
  });

  it('the devoured minion\'s ECHO fires — a death, not a sale (owner ruling 2026-08-06)', () => {
    // `pack` carries an Echo. Devouring it must run that Echo, which is what makes the Broker a Deathrattle
    // enabler rather than a delete button.
    expect(CARD_INDEX['pack']!.effects.some((e) => e.on === 'onDeath'), 'fixture still has an Echo').toBe(true);
    let s = staged([card('bro', 'c3_broker', 5, 8)], [card('n', 'pack', 3, 2)]);
    const before = s.board.length;
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 });
    expect(s.board.some((c) => c.uid === 'n'), 'devoured').toBe(false);
    // Pack Leader's Echo summons bodies — their arrival is the proof the Echo ran at all.
    expect(s.board.length, 'the Echo summoned into the freed space').toBeGreaterThan(before);
  });
});

describe('ORRERY — the capstone devourer', () => {
  it('devours only on its THIRD adjacent arrival, and splits the parcel across your Celestials', () => {
    // Orbit (3). Every play below lands directly beside the Orrery so all three ticks land on it.
    let s = staged(
      [card('fam', 'c3_familiar', 3, 1), card('orr', 'c3_orrery', 8, 8)],
      [card('n1', 'alley', 1, 1), card('n2', 'stray', 1, 1), card('n3', 'sandbag', 9, 1)],
    );
    s = reduce(s, { type: 'play', uid: 'n1', toIndex: 2 }); // tick 1
    expect(s.board.some((c) => c.uid === 'n1'), 'survives the first tick').toBe(true);
    s = reduce(s, { type: 'play', uid: 'n2', toIndex: 2 }); // tick 2 (lands between fam-side and Orrery)
    expect(s.board.some((c) => c.uid === 'n2'), 'survives the second tick').toBe(true);
    const parcel = bonusOf(card('n3', 'sandbag', 9, 1)).a;
    const before = s.board.filter((c) => c.uid !== 'n3').reduce((n, c) => n + c.attack, 0);
    s = reduce(s, { type: 'play', uid: 'n3', toIndex: 2 }); // tick 3 → devoured
    expect(s.board.some((c) => c.uid === 'n3'), 'devoured on the third Orbit').toBe(false);
    const after = s.board.reduce((n, c) => n + c.attack, 0);
    expect(after - before, 'the whole parcel was shared out').toBeGreaterThanOrEqual(parcel);
  });
});
