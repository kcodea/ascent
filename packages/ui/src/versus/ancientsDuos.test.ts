// @vitest-environment jsdom
/**
 * ANCIENTS × THE DUOS HEROES on the client (R-ANCDUOS-01; owner 2026-11-10: "we arent turning ancients on just yet, but
 * build it out").
 *
 * 1. THE SEAM IS THE BUILD. `versusDevAncients` answers only on a DEV server or a bench bundle; in a player build it is
 *    `undefined` whatever local storage says, and no other file in the UI turns Ancients on for a Versus run.
 * 2. The Magic Hat's counter and ready glow follow the picked pairing (Genesis: 8 buys; Bonds: no per-turn cap).
 * 3. A RELOAD mid-turn (the restore replay, `replayRestore`): the passes the room already holds are played again on the
 *    sender's run, so what a pairing gave the SENDER comes back (the turn was dropped with the reload), and the
 *    teammate's run, which already answered those pass keys, gains nothing a second time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX } from '@game/content';
import { ANCIENT_IDS, createVersusRun, duosWireOf, heroPowerArmed, reduce, type Action, type AncientId, type BoardCard, type RunState } from '@game/sim';
import { magicHatBadge } from '../magicHatUi';
import { VERSUS_DEV_ANCIENTS_KEY, versusDevAncients } from './versusDevAncients';
import type { VersusDuosPassRow } from './versusRemote';

vi.mock('../fx/playDef', () => ({ playDef: vi.fn(), canPlayDefs: () => true }));
const { replayRestore } = await import('./duosPasses');

const DUOS = { v: 1 as const, mode: 'duos' as const, modifiers: [] };
const PLAIN = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.tier <= 2 && c.effects.length === 0 && c.keywords.length === 0).map((c) => c!.id);
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
function ancientRun(heroId: string, pick: AncientId, over: Partial<RunState> = {}): RunState {
  let s = { ...createVersusRun(11, heroId, 'set2', DUOS, 'warden', { ancients: true }), phase: 'recruit', embers: 400, hand: [], board: [], shop: [], spell: null, ...over } as RunState;
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [pick, ...ANCIENT_IDS.filter((a) => a !== pick).slice(0, 2)] } };
  return reduce(s, { type: 'pickAncient', id: pick });
}
const buyN = (s: RunState, n: number): RunState => {
  let out = s;
  for (let i = 0; i < n; i++) out = { ...reduce({ ...out, shop: [{ uid: `q${i}`, cardId: PLAIN[i % PLAIN.length]! }] }, { type: 'buy', uid: `q${i}` }), hand: [] };
  return out;
};

afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); });

describe('the Duos Ancients seam is the build, not a setting', () => {
  it('a DEV server or a bench bundle reads the key; anything else is off', () => {
    expect(versusDevAncients()).toBeUndefined(); // no key
    localStorage.setItem(VERSUS_DEV_ANCIENTS_KEY, '1');
    expect(versusDevAncients()).toBe(true);
    localStorage.setItem(VERSUS_DEV_ANCIENTS_KEY, 'cost:1');
    expect(versusDevAncients()).toEqual({ cost: 1 });
    localStorage.setItem(VERSUS_DEV_ANCIENTS_KEY, '0');
    expect(versusDevAncients()).toBeUndefined();
  });

  it('a player build never turns it on, whatever local storage holds', () => {
    localStorage.setItem(VERSUS_DEV_ANCIENTS_KEY, 'cost:1');
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PERF_BENCH', '');
    expect(versusDevAncients()).toBeUndefined();
    // A bench bundle is the other build that may.
    vi.stubEnv('VITE_PERF_BENCH', '1');
    expect(versusDevAncients()).toEqual({ cost: 1 });
  });

  it('it is the only way in: one call site passes `ancients` to createVersusRun, and it reads the seam', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(root);
    const callers = files.filter((f) => /createVersusRun\(/.test(readFileSync(f, 'utf8')));
    const withAncients = callers.filter((f) => /createVersusRun\([^;]*ancients/.test(readFileSync(f, 'utf8')));
    expect(withAncients.map((f) => f.replace(/\\/g, '/').split('/').pop())).toEqual(['versusStore.ts']);
    const store = readFileSync(withAncients[0]!, 'utf8');
    expect(store).toMatch(/const devAncients = versusDevAncients\(\);/);
    // The seam file gates on the build, statically, before it reads anything.
    const seam = readFileSync(join(__dirname, 'versusDevAncients.ts'), 'utf8');
    expect(seam).toMatch(/if \(!\(import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_PERF_BENCH === '1'\)/);
    // And nothing else in the UI enables Ancients on a Versus run by hand.
    const enablers = files.filter((f) => /enableAncients\(/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(/\\/g, '/').split('/').pop());
    expect(enablers).toEqual(['store.ts']); // the Scene Builder
  });
});

describe('the Magic Hat counter and ready glow follow the picked pairing', () => {
  it('Genesis: the counter runs to 8 and the glow waits until the next buy is the 8th', () => {
    let s = buyN(ancientRun('magician', 'genesis'), 5);
    expect(magicHatBadge(s)).toMatchObject({ tally: '5/8', ready: false, active: false });
    expect(heroPowerArmed(s)).toBe(false);
    s = buyN(s, 2);
    expect(magicHatBadge(s)).toMatchObject({ tally: '7/8', ready: true, active: true, status: '7/8 · ready' });
    expect(heroPowerArmed(s)).toBe(true);
    // Never in combat (nothing can be bought there).
    expect(magicHatBadge({ ...s, phase: 'combat' })!.ready).toBe(false);
  });

  it('Bonds: the hat is ready again after two copies in one turn (no cap)', () => {
    let s = ancientRun('magician', 'bonds');
    for (let i = 0; i < 2; i++) s = buyN(s, 3);
    s = buyN(s, 2);
    expect(s.duos!.outbox.filter((e) => e.hat)).toHaveLength(2);
    expect(magicHatBadge(s)).toMatchObject({ tally: '2/3', ready: true, capped: false });
  });

  it('no pairing: the plain hat (3 buys, capped after two copies)', () => {
    let s = { ...createVersusRun(11, 'magician', 'set2', DUOS), phase: 'recruit', embers: 400, hand: [], board: [], shop: [], spell: null } as RunState;
    for (let i = 0; i < 2; i++) s = buyN(s, 3);
    s = buyN(s, 3);
    expect(magicHatBadge(s)).toMatchObject({ tally: '3/3', ready: false, capped: true });
  });
});

describe('a reload mid-turn: the restore replay gives the sender back what the dropped turn held, and the teammate nothing twice', () => {
  /** The room's rows for `run`'s outbox, as `versus_duos_passes` returns them. */
  const rowsOf = (run: RunState, status: VersusDuosPassRow['status'] = 'landed'): VersusDuosPassRow[] =>
    run.duos!.outbox.map((e) => ({ match_id: 'm', round: e.wave, from_seat: 'p1', to_seat: 'p2', seq: e.seq, card: duosWireOf(e) as unknown as VersusDuosPassRow['card'], status, created_at: `2026-11-10T12:00:0${e.seq}.000000+00:00`, answered_at: null }) as VersusDuosPassRow);
  const replay = (start: RunState, rows: VersusDuosPassRow[]): RunState => {
    let run = start;
    replayRestore(() => run, (a) => { run = reduce(run, a as Action); }, 'p1', rows);
    return run;
  };
  const mateBoard = (): BoardCard[] => [card('x', PLAIN[0]!, { attack: 2, health: 2 })];
  const mate = (): RunState => ({ ...createVersusRun(12, 'warden', 'set2', DUOS, 'priestess'), phase: 'recruit', hand: [], board: mateBoard(), shop: [], spell: null } as RunState);
  const land = (to: RunState, rows: VersusDuosPassRow[]): RunState => rows.reduce((b, r) => reduce(b, { type: 'receivePass', from: r.from_seat, seq: r.seq, card: r.card as unknown as BoardCard }), to);

  it('Priestess × Bonds: my left-most minion has its +4/+4 again; my teammate\'s is not buffed a second time', () => {
    const before = ancientRun('priestess', 'bonds', { board: [card('a', PLAIN[0]!, { attack: 1, health: 1 }), card('b', PLAIN[1]!)], hand: [card('h', PLAIN[2]!)], heroReady: true });
    // The turn as played: an ordinary pass, then Passaria.
    let played = reduce(before, { type: 'passCard', uid: 'h' });
    played = reduce(played, { type: 'heroPower', uid: 'b' });
    expect(played.board[0]).toMatchObject({ uid: 'a', attack: 9, health: 9 });
    const rows = rowsOf(played);
    const b = land(mate(), rows);
    expect(b.board[0]).toMatchObject({ attack: 10, health: 10 });
    // The reload: my run is the one from before the turn's actions; the room holds both passes.
    const back = replay(before, rows);
    expect(back.duos!.outbox).toHaveLength(2);
    expect(back.board.map((c) => [c.uid, c.attack, c.health])).toEqual([['a', 9, 9]]);
    expect(back.embers).toBe(played.embers);
    expect(back.heroReady).toBe(false);
    // The teammate reads the same rows again (its own pull after my reload): every key is answered.
    expect(land(b, rows)).toBe(b);
  });

  it('Priestess × Genesis: the replayed Passaria pays its 4 Gold and puts the plain copy back in my hand', () => {
    const before = ancientRun('priestess', 'genesis', { board: [card('b', PLAIN[1]!)], heroReady: true });
    const played = reduce(before, { type: 'heroPower', uid: 'b' });
    const back = replay(before, rowsOf(played));
    expect(back.embers).toBe(before.embers - 4);
    expect(back.hand.map((c) => c.cardId)).toEqual([PLAIN[1]]);
    expect(back.board).toHaveLength(0);
  });

  it('Magician × Genesis: three spell copies are ONE pass, so the replay counts one copy against the turn', () => {
    const spell = Object.values(CARD_INDEX).find((c) => c && c.spell && !c.ruby && !c.token && !c.duos && (c.cost ?? 0) <= 3)!.id;
    const before = ancientRun('magician', 'genesis');
    // A hat of eight of that spell (bought out of the Shop row), so the card the hat picks is the spell.
    let played = before;
    for (let i = 0; i < 8; i++) played = { ...reduce({ ...played, shop: [{ uid: `z${i}`, cardId: spell }] }, { type: 'buy', uid: `z${i}` }), hand: [] };
    const rows = rowsOf(played);
    expect(rows).toHaveLength(1);
    const back = replay(before, rows);
    expect(back.duos!.outbox).toHaveLength(1);
    expect(back.magicHatSent).toBe(1);
  });
});
