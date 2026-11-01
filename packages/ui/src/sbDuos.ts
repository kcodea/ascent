/**
 * THE SCENE BUILDER'S PLACEHOLDER DUOS TEAMMATE (DEV only: this module lives in the Scene Builder's lazy chunk, which a
 * production build drops). Owner ask 2026-10-31, R-SB-DUOS-01:
 *
 *   "scene builder needs a duo toggle which gives a placeholder teammate to view their board and pass things to, a
 *    button on the builder tuner to have the teammate pass to you, and the duos minions and spells in the shop/list
 *    when active"
 *
 * With the rig's Duos toggle on, the sandbox run is a Duos-style run (`state.duos`, the Duos pool) and this module holds
 * a SECOND run in the browser for the teammate (seeded off yours, a placeholder hero, your tribes, the same set). There
 * is no Worker: the local team channel (`sbDuosChannel.ts`) carries passes and team effects both ways through the same
 * run actions a match uses. The real Duos UI runs on top through one seam (`versus/localMate.ts`): the bottom-right
 * teammate portrait, the drag-to-portrait pass and its refusals, and the view swap (the same cross-fade).
 *
 * VIEWING THE TEAMMATE puts THEIR run in the store (my own is held here, untouched), exactly like the real teammate view
 * holds my run aside, but their screen is LIVE, not a watch screen: every Scene Builder tool (the library, the edit
 * mode, the board and shop sweeps) and every normal play edits their run, and a drag onto the portrait (it is you while
 * you look) passes to you. Their run never fights: End Turn on their screen takes you back to yours.
 */
import { create } from 'zustand';
import { CARD_INDEX } from '@game/content';
import {
  createLobbyRun, duosPassBlocked, duosPassCost, handCap, passMinionToTeammate, playableHeroes, reduce,
  type Action, type BoardCard, type PracticeConfig, type PracticeTribe, type RunState,
} from '@game/sim';
import { useGame } from './store';
import { installLocalMate, useLocalMate, type LocalMateApi } from './versus/localMate';
import { useSpectate } from './versus/spectate';
import { exitTeammateView } from './versus/teammateView';
import { playArrival, playEntryFlight } from './versus/passLob';
import { notePassRefused, passReturnedText } from './versus/duosPassUi';
import { devCard } from './versus/duosDevTuner';
import { sfx } from './sfx';
import { deliverSbTeam, newSbLedger, releaseSbCombatFx, sbHandRoom, type SbLedger, type SbSeat } from './sbDuosChannel';

/** The placeholder teammate's name pill. */
export const SB_MATE_NAME = 'Placeholder';

interface SbDuosState {
  /** The run NOT on screen: the teammate's while I am on my board, mine while I view theirs. */
  other: RunState | null;
  /** The screen shows the teammate's run. */
  viewing: boolean;
  /** The seed of MY run the teammate was made for (a rig restart makes a fresh teammate). */
  forSeed: number | null;
  /** The teammate run's seed (to tell their run from mine in the store). */
  mateSeed: number | null;
  /** The last tuner result (or why it could not), for the panel. */
  note: string | null;
}

export const useSbDuos = create<SbDuosState>(() => ({ other: null, viewing: false, forSeed: null, mateSeed: null, note: null }));

let ledger: SbLedger = newSbLedger();

/** The teammate run's seed, from mine (deterministic: the same rig seed always makes the same teammate). */
export const sbMateSeed = (mySeed: number): number => (mySeed ^ 0x5eed_d405) >>> 0;

/** The placeholder hero: a playable hero other than mine, picked by the seed. */
export function sbMateHero(mySeed: number, myHero: string): string {
  const pool = playableHeroes().filter((h) => h.id !== myHero);
  return pool[sbMateSeed(mySeed) % Math.max(1, pool.length)]?.id ?? myHero;
}

/** A fresh teammate run for MY run: same set, same tribes, a Duos run, sandboxed (God rules: the Gold float too). */
export function makeSbMateRun(mine: RunState, god: boolean): RunState {
  const config: PracticeConfig = { opponents: 'bots', botDifficulty: 1, health: 'unlimited', timeMult: 1, tribes: mine.tribes.filter((t): t is PracticeTribe => t !== 'neutral') };
  const base = createLobbyRun(sbMateSeed(mine.seed), sbMateHero(mine.seed, mine.heroId), {}, 'practice', config, mine.setId, undefined, { duos: true });
  return { ...base, sandbox: true, tier: mine.tier, ...(god ? { embers: 999 } : {}) };
}

// ── run access (whichever run is on screen goes through the store) ──────────────────────────────────────────────────

const onScreenSeat = (): SbSeat => (useSbDuos.getState().viewing ? 'p2' : 'p1');
function runOf(seat: SbSeat): RunState {
  return seat === onScreenSeat() ? useGame.getState().run : useSbDuos.getState().other!;
}
/** A run action on a seat's run: the store's own dispatch for the run on screen (its FX, triples and diffs run), the
 *  reducer for the other. */
function act(seat: SbSeat, a: Action): void {
  if (seat === onScreenSeat()) { useGame.getState().dispatch(a); return; }
  const other = useSbDuos.getState().other;
  if (other) useSbDuos.setState({ other: reduce(other, a) });
}
/** A direct dev edit of a seat's run (labelled dev: setting up a card before the real path runs on it). */
function edit(seat: SbSeat, fn: (r: RunState) => RunState): void {
  if (seat === onScreenSeat()) { useGame.setState({ run: fn(useGame.getState().run) }); return; }
  const other = useSbDuos.getState().other;
  if (other) useSbDuos.setState({ other: fn(other) });
}

/** The teammate's run and mine, wherever each is right now. */
export const sbMateRun = (): RunState | null => (useSbDuos.getState().other ? runOf('p2') : null);
export const sbMyRun = (): RunState | null => (useSbDuos.getState().other ? runOf('p1') : null);

// ── the local channel pump ──────────────────────────────────────────────────────────────────────────────────────────

let pumping = false;
let queued = false;
/** Deliver what is new, after the current commit (a pass lands the way a network answer would: never inside it). */
function schedulePump(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; pump(); });
}
function pump(): void {
  if (pumping || !useSbDuos.getState().other || !useGame.getState().run.duos) return;
  pumping = true;
  try {
    const events = deliverSbTeam(runOf, act, ledger);
    const screen = onScreenSeat();
    for (const ev of events) {
      if (ev.kind === 'landed' && ev.to === screen && !ev.triple) for (const uid of ev.uids) playArrival(uid);
      if (ev.kind === 'refused' && ev.from === screen && !ev.team) {
        sfx.deny?.();
        notePassRefused(passReturnedText(ev.reason));
      }
    }
  } finally { pumping = false; }
}

/** The outbox length of the on-screen run last seen (to stream each send from its source before React drops it:
 *  R-DUOS-PASS-FLIGHT-01). */
let seenOutbox = 0;
function onStoreRun(run: RunState, prev: RunState): void {
  const st = useSbDuos.getState();
  // The rig restarted under the teammate's screen (a new run in the store that is neither of ours): back to mine.
  if (st.viewing && run.seed !== st.mateSeed && run !== prev) {
    useSbDuos.setState({ viewing: false });
    useSpectate.setState({ teammate: false });
  }
  syncTeam(run);
  const out = run.duos?.outbox ?? [];
  if (out.length < seenOutbox) seenOutbox = 0;
  // A fight's gifts wait for their `teamSend` beat (`releaseCombatFx`), like the match's.
  for (let i = seenOutbox; i < out.length; i++) if (out[i]!.combatIdx == null) playEntryFlight(out[i]!, run);
  seenOutbox = out.length;
  if (run.duos) schedulePump();
}

/** Keep the teammate in step with the rig's run: made for a new Duos run, dropped when Duos is off. */
function syncTeam(run: RunState): void {
  const st = useSbDuos.getState();
  if (!run.sandbox || !run.duos) {
    if (st.other) resetTeam();
    return;
  }
  if (st.viewing) return; // the store holds the teammate's run: mine is safe in `other`
  if (st.forSeed === run.seed && st.other) return;
  const mate = makeSbMateRun(run, useGame.getState().sbRules === 'god');
  ledger = newSbLedger();
  seenOutbox = run.duos.outbox.length;
  useSbDuos.setState({ other: mate, forSeed: run.seed, mateSeed: mate.seed, viewing: false, note: null });
  useLocalMate.setState({ me: { hero: run.heroId, name: 'You' }, mate: { hero: mate.heroId, name: SB_MATE_NAME } });
}

function resetTeam(): void {
  if (useSbDuos.getState().viewing) useSpectate.setState({ teammate: false });
  useSbDuos.setState({ other: null, viewing: false, forSeed: null, mateSeed: null, note: null });
  ledger = newSbLedger();
  useLocalMate.setState({ me: null, mate: null });
}

// ── the seam the Duos UI reads ──────────────────────────────────────────────────────────────────────────────────────

const api: LocalMateApi = {
  handFull: () => {
    const other = useSbDuos.getState().other;
    return !!other && sbHandRoom(other) <= 0;
  },
  enter: () => {
    const st = useSbDuos.getState();
    const mine = useGame.getState().run;
    if (st.viewing || !st.other || mine.phase !== 'recruit') return;
    // Their run in the store, mine held here. The real teammate view's key-hold (Game.tsx) keeps the board mounted.
    useSbDuos.setState({ other: mine, viewing: true });
    seenOutbox = st.other.duos?.outbox.length ?? 0;
    useGame.setState({ run: st.other, inspect: null, heroArmed: false });
    useSpectate.setState({ teammate: true });
  },
  exit: () => {
    const st = useSbDuos.getState();
    if (!st.viewing || !st.other) return;
    const mate = useGame.getState().run;
    useSbDuos.setState({ other: mate, viewing: false });
    seenOutbox = st.other.duos?.outbox.length ?? 0;
    useGame.setState({ run: st.other, inspect: null, heroArmed: false });
    useSpectate.setState({ teammate: false });
    schedulePump();
  },
  back: () => exitTeammateView(),
  viewing: () => useSbDuos.getState().viewing,
  releaseCombatFx: (wave, idx) => {
    // Each gift streams from the unit that sent it, on its beat (R-DUOS-PASS-FLIGHT-01).
    const run = useGame.getState().run;
    for (const e of run.duos?.outbox ?? []) if (e.wave === wave && e.combatIdx != null && idx.includes(e.combatIdx)) playEntryFlight(e, run);
    releaseSbCombatFx(ledger, onScreenSeat(), wave, idx);
    schedulePump();
  },
};

let unsub: (() => void) | null = null;
/** Turn the placeholder team on (the rig's Duos toggle, with a Duos sandbox run). Idempotent. */
export function installSbDuos(): void {
  if (unsub) return;
  installLocalMate(api);
  unsub = useGame.subscribe((s, prev) => { if (s.run !== prev.run) onStoreRun(s.run, prev.run); });
  syncTeam(useGame.getState().run);
}
/** Off: back to my own board, the teammate dropped, the seam removed. */
export function uninstallSbDuos(): void {
  if (!unsub) return;
  if (useSbDuos.getState().viewing) api.exit();
  unsub();
  unsub = null;
  resetTeam();
  installLocalMate(null);
  if (typeof document !== 'undefined') document.body.classList.remove('duos-viewing');
}

// ── the tuner: the teammate does something to you ───────────────────────────────────────────────────────────────────

const say = (note: string): void => useSbDuos.setState({ note });
const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(Math.random() * xs.length)];

/** What the teammate passes: a card by id (it lands in their hand first, then goes through their real drag pass), a
 *  random card of their hand (the drag pass) or a random minion of their board (an effect pass, Handout's path). */
export type SbMatePass = { kind: 'card'; cardId: string } | { kind: 'hand' } | { kind: 'board' };

/**
 * TEAMMATE PASSES TO YOU. Every route is the teammate run's own pass (`passCard`, or `passMinionToTeammate` for a board
 * minion) and then the local channel: your run receives it through `receivePass`, so it counts as a pass on both sides
 * (Hitchhiker, Spell Theory, Brian's Pal) and obeys every refusal (a full hand; a pass spell never takes a Golden
 * minion, R-DUOS-PASS-GOLDEN-MANUAL-01, while the hand pass may carry one).
 */
export function sbMatePasses(what: SbMatePass): void {
  const mate = sbMateRun();
  if (!mate) { say('No teammate'); return; }
  if (mate.phase !== 'recruit') { say('Their shop is closed'); return; }
  if (what.kind === 'board') {
    const body = pick(mate.board.filter((c) => !c.golden));
    if (!body) { say('Their board has no minion to pass'); return; }
    edit('p2', (r) => {
      const s = structuredClone({ ...r, lastCombat: undefined, servedBoards: undefined }) as RunState;
      s.lastCombat = r.lastCombat;
      s.servedBoards = r.servedBoards;
      return passMinionToTeammate(s, s.board.find((c) => c.uid === body.uid)!) ? s : r;
    });
    say(`Passed ${CARD_INDEX[body.cardId]?.name ?? body.cardId} from their board`);
    schedulePump();
    return;
  }
  let uid: string | undefined;
  if (what.kind === 'card') {
    if (!CARD_INDEX[what.cardId]) { say('Unknown card'); return; }
    if (mate.hand.length >= handCap(mate)) { say('Their hand is full'); return; }
    const made = devCard(mate, what.cardId);
    uid = made.card.uid;
    edit('p2', (r) => ({ ...r, uidSeq: made.run.uidSeq, hand: [...r.hand, made.card] }));
  } else {
    uid = pick(mate.hand)?.uid; // a Golden card may be passed from hand (owner 2026-10-31)
    if (!uid) { say('Their hand has nothing to pass'); return; }
  }
  // Their drag pass costs them its Gold: top them up so the dev button never stalls on it.
  const live = runOf('p2');
  const cost = duosPassCost(live);
  if (live.embers < cost) edit('p2', (r) => ({ ...r, embers: cost }));
  const why = duosPassBlocked(runOf('p2'), uid);
  if (why) { say(`Refused: ${why}`); return; }
  const card = runOf('p2').hand.find((c) => c.uid === uid) as BoardCard;
  act('p2', { type: 'passCard', uid });
  say(`Passed ${CARD_INDEX[card.cardId]?.name ?? card.cardId}`);
  schedulePump();
}

/** TEAMMATE SELLS A MINION (Hippie Hulk's `teammateSold`): the teammate run's own `sell`, whose `sold` team effect the
 *  local channel lands on yours. With an empty board, `cardId` (a minion) goes on it first. */
export function sbMateSells(cardId?: string): void {
  let mate = sbMateRun();
  if (!mate) { say('No teammate'); return; }
  if (mate.phase !== 'recruit') { say('Their shop is closed'); return; }
  if (mate.board.length === 0) {
    const def = cardId ? CARD_INDEX[cardId] : undefined;
    if (!def || def.spell) { say('Their board is empty. Pick a minion to sell'); return; }
    const made = devCard(mate, def.id);
    edit('p2', (r) => ({ ...r, uidSeq: made.run.uidSeq, board: [...r.board, made.card] }));
    mate = runOf('p2');
  }
  const body = pick(mate.board)!;
  act('p2', { type: 'sell', uid: body.uid });
  say(`Sold ${CARD_INDEX[body.cardId]?.name ?? body.cardId}`);
  schedulePump();
}

/** Empty the teammate's hand (to test a pass to a full or an empty hand from both sides). */
export function sbMateClear(zone: 'hand' | 'board'): void {
  if (!sbMateRun()) return;
  edit('p2', (r) => ({ ...r, [zone]: [] }));
  schedulePump(); // room in their hand: waiting effect passes land on their next action
}

/** Fill the teammate's hand to its cap with copies of `cardId` (a full-hand refusal test). */
export function sbMateFillHand(cardId: string): void {
  const mate = sbMateRun();
  if (!mate || !CARD_INDEX[cardId]) return;
  let r = mate;
  const add: BoardCard[] = [];
  while (r.hand.length + add.length < handCap(r)) {
    const made = devCard(r, cardId);
    add.push(made.card);
    r = made.run;
  }
  edit('p2', (x) => ({ ...x, uidSeq: r.uidSeq, hand: [...x.hand, ...add] }));
  say(`Their hand is full (${handCap(r)})`);
}
