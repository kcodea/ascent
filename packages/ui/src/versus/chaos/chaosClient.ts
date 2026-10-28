/**
 * VERSUS CHAOS HARNESS: ONE PLAYER'S CLIENT (the REAL game modules, isolated per player).
 *
 * Each client is its own module graph (`vi.resetModules()` + dynamic import): its own `useGame` main store, its own
 * `versusStore` session controller, its own `versusRemote` (the real adapter over this client's `FakeSupabase`), its own
 * identity and ranked-gate controller. Nothing is shared between clients but the fake clock, the server and the
 * realtime bus, exactly as in a lobby of browser tabs.
 *
 * The `ChaosClient.tick()` UI DRIVER plays the parts of the screen the store relies on (and only those, through the same
 * exported functions the components call):
 *  - the ranked gate (`registerRankedGate`): the doors shut, the player presses the crystal (`onPress`), the end gate
 *    shuts and runs its swap;
 *  - Hero Select + its launch curtain (`launchVersusHero`);
 *  - Recruit's Versus seam (`useVersusRecruit`): End Turn (`lockTurn` / `unreadyTurn`, the `intercept`), the 0:00 lock
 *    (`expireVersusShop`), the real End Turn once the fight is in (`endTurnWave`: the End of Turn animation, then
 *    `faceOmen`), the fight's playback, End Combat (`versusEndCombatPressed`, the leave), and the stale re-read;
 *  - the shop itself: a deterministic seeded bot (`ChaosPolicy`).
 * A HIDDEN tab runs none of the screen work that needs animation frames (the fight does not play, nothing is clicked);
 * its timers and network are throttled by `ChaosNet`.
 */
import { vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { RunState } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import type { ChaosServer } from './chaosServer';
import { ChaosNet, FakeSupabase, type RealtimeBus } from './fakeSupabase';

type StoreMod = typeof import('../versusStore');
type GameMod = typeof import('../../store');
type TurnMod = typeof import('../versusTurn');
type ClockMod = typeof import('../versusClock');
type SimMod = typeof import('@game/sim');

/** How a bot shops (deterministic per seed). */
export type ChaosPolicy =
  /** Buys and plays affordable minions every shop, levels sometimes. */
  | 'buyer'
  /** Buys nothing: an empty board every round. */
  | 'empty'
  /** Buys like `buyer` until round `sellFrom`, then sells everything (a player who sold out). */
  | 'sellout'
  /** Prefers minions with End of Turn effects (a long End of Turn animation every round). */
  | 'eotHeavy';

export interface ChaosClientOptions {
  user: string;
  name: string;
  seed: number;
  policy: ChaosPolicy;
  /** `early`: End Turn as soon as the shop is done; `timer`: never press End Turn (0:00 locks it). */
  endTurn: 'early' | 'timer';
  /** sellout: the first round it sells its whole board (and buys nothing after). */
  sellFrom?: number;
  /** Ms from the shop opening before the bot acts / ends its turn (a person's reaction time). */
  thinkMs?: number;
  /** Ms the bot watches each fight before End Combat. */
  watchMs?: number;
  /** Drop this client's End Combat acks (`combatReady`) for these rounds. */
  dropCombatReady?: number[];
  /** Armor-in-the-shop probe: from this round, once its Armor is under 5, Mend ("Set your Armor to 5") goes into its
   *  shop and it buys and casts it (a SHOP-PHASE pool change the resolver must honour). */
  mendFrom?: number;
}

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/** mulberry32: the bot's own seeded choices. */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ChaosClient {
  readonly net: ChaosNet;
  readonly fake: FakeSupabase;
  store!: StoreMod;
  game!: GameMod;
  turn!: TurnMod;
  clock!: ClockMod;
  sim!: SimMod;
  private rng: () => number;
  /** Driver state. */
  private launching = false;
  private shopSeen: { wave: number; at: number } | null = null;
  private actedWave = -1;
  private endTurnFired = -1;
  private endTurnAt: { wave: number; at: number } | null = null;
  private fightSeen: { wave: number; at: number } | null = null;
  private endCombatPressed = -1;
  private leftWave = -1;
  private gateQueue: { at: number; run: () => void }[] = [];
  private mended = false;
  /** Mend casts that landed: the round and the Armor before -> after (the runner narrates them). */
  readonly mends: { wave: number; before: number; after: number }[] = [];
  /** Rounds this client fought to the end of the fight screen (for the "same fights" invariant). */
  readonly errors: string[] = [];

  constructor(readonly opts: ChaosClientOptions, server: ChaosServer, bus: RealtimeBus) {
    this.net = new ChaosNet(opts.name);
    this.fake = new FakeSupabase(opts.user, server, this.net, bus);
    this.rng = rngOf(opts.seed);
  }

  get hidden(): boolean { return this.net.state.hiddenSince != null; }

  /** Build this client's own module graph. Call one client at a time (module mocks are per import). */
  async build(): Promise<void> {
    vi.resetModules();
    const fake = this.fake;
    const net = this.net;
    const drop = new Set(this.opts.dropCombatReady ?? []);
    vi.doMock(here('../versusRemote.ts'), async (orig) => {
      const real = await orig<typeof import('../versusRemote')>();
      const remote = real.makeVersusRemote(() => fake as never);
      // DROP A combatReady: the call "goes out" and is lost (no server effect, no answer: a timeout to the caller).
      const combatReady = remote.combatReady;
      const groupCombatReady = remote.groupCombatReady;
      remote.combatReady = (m, round) => (drop.has(round) ? lost() : combatReady(m, round));
      remote.groupCombatReady = (m, round) => (drop.has(round) ? lost() : groupCombatReady(m, round));
      // The game's adapter is the cutover ROUTER (R-VERSUS-CF-CUTOVER-01) over the Supabase adapter: wrap the fake-backed
      // remote in the real router with no Cloudflare transport, so every call takes the Supabase path exactly as a build
      // without a Worker does, and the router's own surface (`hostOf`, `noteRoomHost`, ...) is the real one.
      const { makeRoutedVersusRemote } = await import('../versusRouter');
      const { makeRoomHostMemory } = await import('../versusHost');
      const routed = makeRoutedVersusRemote({
        supabase: remote, cf: null, memory: makeRoomHostMemory(null),
        readConfig: async () => ({ duel: 'supabase', group: 'supabase', duos: 'supabase', ranked_duos: 'supabase' }),
      });
      return { ...real, versusRemote: routed };
    });
    vi.doMock(here('../../net/backoff.ts'), async (orig) => ({
      ...(await orig<typeof import('../../net/backoff')>()),
      pageHidden: () => net.state.hiddenSince != null,
    }));
    this.store = await import('../versusStore');
    this.game = await import('../../store');
    this.turn = await import('../versusTurn');
    this.clock = await import('../versusClock');
    this.sim = await import('@game/sim');
    const identity = await import('../../identity');
    const gate = await import('../../rankedGate/rankedGateController');
    vi.doUnmock(here('../versusRemote.ts'));
    vi.doUnmock(here('../../net/backoff.ts'));
    identity.setIdentity({ userId: this.opts.user, displayName: this.opts.name, anonymous: true, email: null } as never);
    this.game.useGame.setState({ playerName: this.opts.name } as never);
    // THE GATE: the doors shut, then the player presses the crystal (about a second later, while the tab is visible).
    gate.registerRankedGate((onShut, variant, o) => new Promise<void>((resolve) => {
      onShut();
      if (variant !== 'entry' || !o?.onPress) { resolve(); return; }
      this.gateQueue.push({ at: Date.now() + 1000, run: () => { void o.onPress!().finally(resolve); } });
    }), () => undefined);
  }

  // ── what the screen shows (the recorder reads these) ─────────────────────────────────────────────────────────
  view(): ClientView {
    const v = this.store.useVersus.getState();
    const g = this.game.useGame.getState();
    const run = g.run;
    const m = v.match;
    const t = this.turn.versusTurn({ match: m, seat: this.store.mySeat(m), lockedRound: v.lockedRound, readyRound: v.readyRound, run, now: this.store.versusServerNow() });
    return {
      matchId: m?.id ?? null, phase: m?.phase ?? null, round: m?.round ?? null, revision: m?.revision ?? null, paused: !!m?.paused_at,
      runMode: run.mode ?? 'lobby', runPhase: run.phase, wave: run.wave, combatSettled: !!run.combatSettled, turn: t.kind,
      lockedRound: v.lockedRound, readyRound: v.readyRound, endTurnWave: v.endTurnWave, screen: v.screen,
      resolve: run.resolve, armor: run.armor, spectating: typeof run.runId === 'string' && run.runId.startsWith('spectate:'),
      rail: run.mode === 'versus' && run.lobby ? run.lobby.seats.map((s) => ({ label: s.label, resolve: s.resolve, armor: s.armor, placement: s.placement ?? null })) : [],
    };
  }

  // ── the room (through the store's own functions, as the room screen calls them) ─────────────────────────────
  async createRoom(mode: string): Promise<string> {
    if (mode === 'ranked_duos') await this.store.createDuosParty(`${this.opts.name}'s party`);
    else {
      await this.store.createRoom(`${this.opts.name}'s room`);
      if (mode !== 'duel') await this.store.setRoomOptions({ v: 1, mode, modifiers: [] } as never);
    }
    const room = this.store.useVersus.getState().room;
    if (!room) throw new Error(`${this.opts.name}: no room (${this.store.useVersus.getState().error}; ${this.fake.lastError ?? 'no RPC error'})`);
    return room.id;
  }
  async join(roomId: string, mode: string): Promise<void> {
    await this.store.joinRoom(roomId, 'player');
    if (!this.store.useVersus.getState().room) throw new Error(`${this.opts.name}: join failed (${this.store.useVersus.getState().error}; ${this.fake.lastError ?? 'no RPC error'})`);
    if (mode === 'ranked_duos') return; // a party join takes its free seat itself
  }
  async takeSeat(role: string): Promise<void> {
    const ok = await this.store.takeSeat(role as never);
    if (!ok) throw new Error(`${this.opts.name}: take ${role} failed (${this.store.useVersus.getState().error}; ${this.fake.lastError ?? 'no RPC error'})`);
  }
  async start(): Promise<void> { await this.store.startGame(); }

  // ── the screen, once per harness step ───────────────────────────────────────────────────────────────────────
  tick(): void {
    const now = Date.now();
    if (this.hidden || this.net.state.offline) {
      // A hidden tab: nothing is clicked, the fight does not play (no animation frames). An offline tab still renders
      // and plays, but every call fails (the store retries); the player keeps playing.
      if (this.hidden) return;
    }
    for (const q of this.gateQueue.splice(0)) {
      if (q.at <= now) q.run();
      else this.gateQueue.push(q);
    }
    const S = this.store;
    const g = this.game.useGame.getState();
    const v = S.useVersus.getState();
    const m = v.match;
    // HERO SELECT: pick (a person takes a moment), then the launch curtain waits for the run.
    if (g.pendingMode === 'versus' && g.heroChoices && g.heroChoices.length && !this.launching && m?.phase === 'hero_select') {
      const pick = g.heroChoices[Math.floor(this.rng() * g.heroChoices.length)]!;
      this.launching = true;
      void S.launchVersusHero(pick).finally(() => { this.launching = false; });
      return;
    }
    // A timeout pick: the ceremony plays it, then the launch.
    if (g.pendingMode === 'versus' && g.heroChoices && !this.launching && m && m.heroes_revealed && v.pickedFor !== m.id) {
      const seat = S.mySeat(m);
      const hero = seat === 'p1' ? m.p1_hero : seat === 'p2' ? m.p2_hero : null;
      if (hero) {
        S.markVersusPickShown();
        this.launching = true;
        void S.launchVersusHero(hero).finally(() => { this.launching = false; });
      }
    }
    const run = g.run;
    if (run.mode !== 'versus' || !m) return;
    const seat = S.mySeat(m);
    if (!seat) return;
    const t = this.turn.versusTurn({ match: m, seat, lockedRound: v.lockedRound, readyRound: v.readyRound, run, now: S.versusServerNow() });
    if (t.stale) S.rereadVersusMatch();
    const paused = !!m.paused_at && m.phase !== 'complete';

    if (run.phase === 'recruit') {
      this.fightSeen = null;
      // The fight is in: Recruit plays the real End Turn (its End of Turn animation first), once per wave.
      if (v.endTurnWave === run.wave && !paused && this.endTurnFired !== run.wave) {
        if (!this.endTurnAt || this.endTurnAt.wave !== run.wave) this.endTurnAt = { wave: run.wave, at: now + this.eotAnimationMs(run) };
        if (now >= this.endTurnAt.at) {
          this.endTurnFired = run.wave;
          g.dispatch({ type: 'faceOmen' });
        }
        return;
      }
      if (m.phase === 'shop' && m.round === run.wave && m.shop_deadline && !paused) {
        if (!this.shopSeen || this.shopSeen.wave !== run.wave) this.shopSeen = { wave: run.wave, at: now };
        // The 0:00 lock (`useVersusRecruit`'s clock effect).
        if (this.clock.shopClockAt(S.versusShopRemainingMs(m.shop_deadline)).locked) { S.expireVersusShop(); return; }
        if (this.actedWave !== run.wave && now - this.shopSeen.at >= (this.opts.thinkMs ?? 1500)) {
          this.actedWave = run.wave;
          this.shop();
          if (this.opts.endTurn === 'early') this.pressEndTurn();
        }
      }
      return;
    }

    if (run.phase === 'combat') {
      if (!this.fightSeen || this.fightSeen.wave !== run.wave) this.fightSeen = { wave: run.wave, at: now };
      // The next shop is open for both: the fight leaves through its ordinary exit (`useVersusRecruit` 'leave').
      if (t.kind === 'leave') {
        if (this.leftWave !== run.wave) { this.leftWave = run.wave; this.endCombat(); }
        return;
      }
      // The player watches the fight, then presses End Combat.
      if (now - this.fightSeen.at >= (this.opts.watchMs ?? 3500) && this.endCombatPressed !== run.wave && !paused) {
        this.endCombatPressed = run.wave;
        this.endCombat();
      }
    }
  }

  /** Recruit's End Turn button: `useVersusRecruit().intercept()`. */
  pressEndTurn(): void {
    const S = this.store;
    const run = this.game.useGame.getState().run;
    if (S.useVersus.getState().endTurnWave === run.wave) return; // the real End Turn is the store's to fire
    if (S.unreadyTurn()) return;
    void S.lockTurn();
  }

  /** Recruit's `endCombat` (the fight's End Combat gem / the leave): stay while the other player is not back. */
  private endCombat(): void {
    const S = this.store;
    const g = this.game.useGame.getState();
    const run = g.run;
    if (!S.versusMatchEndsAtPress(run) && S.versusEndCombatPressed(run)) return;
    if (S.versusMatchEndsAtPress(run)) {
      this.gateQueue.push({ at: Date.now() + 600, run: () => S.finishVersusMatch() });
      return;
    }
    // The exit curtain (~0.6 s), then the fight resolves into the next shop.
    this.gateQueue.push({
      at: Date.now() + 600,
      run: () => {
        const st = this.game.useGame.getState();
        if (st.run.mode !== 'versus' || st.run.phase !== 'combat') return;
        if (!st.run.combatSettled) st.dispatch({ type: 'settleCombat' });
        this.game.useGame.getState().dispatch({ type: 'resolveCombat' });
      },
    });
  }

  /** Recruit's End of Turn animation before the fight: about 0.45 s per End of Turn beat (a heavy board takes seconds). */
  private eotAnimationMs(run: RunState): number {
    let beats = 0;
    for (const c of run.board) if (CARD_INDEX[c.cardId]?.effects.some((e) => e.on === 'endOfTurn')) beats++;
    return 50 + beats * 450;
  }

  // ── the bot's shop ───────────────────────────────────────────────────────────────────────────────────────────
  private dispatch(a: any): boolean {
    const before = this.game.useGame.getState().run;
    this.game.useGame.getState().dispatch(a);
    return this.game.useGame.getState().run !== before;
  }

  private shop(): void {
    const policy = this.opts.policy;
    const runNow = (): RunState => this.game.useGame.getState().run;
    this.answerModals();
    if (this.opts.mendFrom != null && runNow().wave >= this.opts.mendFrom && !this.mended && runNow().armor < 5) this.castMend();
    if (policy === 'empty') return;
    if (policy === 'sellout' && runNow().wave >= (this.opts.sellFrom ?? 3)) {
      for (const c of [...runNow().board]) this.dispatch({ type: 'sell', uid: c.uid });
      return;
    }
    for (let i = 0; i < 12; i++) {
      this.answerModals();
      const run = runNow();
      const room = run.board.length + run.hand.length < 7;
      if (run.hand.length && run.board.length < 7) {
        const card = run.hand[0]!;
        if (this.dispatch({ type: 'play', uid: card.uid })) continue;
        if (run.board.length && this.dispatch({ type: 'play', uid: card.uid, targetUid: run.board[0]!.uid })) continue;
      }
      if (run.wave >= 3 && this.rng() < 0.25 && this.dispatch({ type: 'upgrade' })) continue;
      if (room) {
        let offers = run.shop.filter((o) => this.sim.offerBuyPrice(run, o).cost <= run.embers && !CARD_INDEX[o.cardId]?.spell);
        if (policy === 'eotHeavy') {
          const eot = offers.filter((o) => CARD_INDEX[o.cardId]?.effects.some((e) => e.on === 'endOfTurn'));
          if (eot.length) offers = eot;
        }
        if (offers.length && this.dispatch({ type: 'buy', uid: offers[Math.floor(this.rng() * offers.length)]!.uid })) continue;
      }
      break;
    }
    this.answerModals();
  }

  /** Answer any open Discover / choice the way a timeout would (a random legal answer). */
  private answerModals(): void {
    for (let i = 0; i < 4; i++) {
      const run = this.game.useGame.getState().run;
      if (!this.sim.modalOpen(run)) return;
      const answered = this.sim.versusAutoResolve(run, this.sim.versusTimeoutRng(this.opts.seed, run.wave, 'p1'));
      if (answered === run) return;
      this.game.useGame.setState({ run: answered });
    }
  }

  /** A test injection (the Scene Builder's kind): Mend goes into the shop with the Gold to buy it; then the real buy and
   *  the real cast through the reducer. */
  private castMend(): void {
    this.mended = true;
    const cur = this.game.useGame.getState().run;
    const uid = `chaos-mend-${cur.wave}`;
    const run = { ...cur, shop: [...cur.shop, { uid, cardId: 'mend' }], embers: Math.max(cur.embers, 10) } as RunState;
    this.game.useGame.setState({ run });
    this.dispatch({ type: 'buy', uid });
    const card = this.game.useGame.getState().run.hand.find((c) => c.cardId === 'mend');
    if (card) this.dispatch({ type: 'play', uid: card.uid });
    const after = this.game.useGame.getState().run;
    if (after.armor !== cur.armor) this.mends.push({ wave: after.wave, before: cur.armor, after: after.armor });
    else this.errors.push(`Mend did not change Armor in round ${after.wave} (${cur.armor})`);
  }
}

/** A request that is lost (it never reaches the server, the caller's promise never settles). */
function lost<T>(): Promise<T> { return new Promise<T>(() => undefined); }

export interface ClientView {
  matchId: string | null;
  phase: string | null;
  round: number | null;
  revision: number | null;
  paused: boolean;
  runMode: string;
  runPhase: string;
  wave: number;
  combatSettled: boolean;
  turn: string;
  lockedRound: number | null;
  readyRound: number | null;
  endTurnWave: number | null;
  screen: string;
  resolve: number;
  armor: number;
  /** The screen shows someone else's run (the stands, or the Duos teammate view). */
  spectating: boolean;
  rail: { label: string; resolve: number; armor: number; placement: number | null }[];
}
