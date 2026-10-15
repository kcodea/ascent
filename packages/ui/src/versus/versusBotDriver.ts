/**
 * VERSUS TEST BOT — the driver (owner 2026-10-14: "add the ability to add a bot ... to just test the versus mode
 * myself ... play random minions, doesnt need to be good at the game").
 *
 * A REAL second participant: it talks to the server only through the same API a person's client uses (join the
 * seat, press the gate gem, pick a hero, submit the lock, finalize, acknowledge the fight, heartbeat), and plays its
 * own Versus run locally with the real reducer. It is not smart: each shop it buys random affordable minions, plays
 * them, sometimes refreshes or levels, answers every Discover / choice with a random legal pick, then ends its turn.
 *
 * Pure and clock-injected: no timers, no network of its own, no React. The host (`versusBot.ts` in the browser, the
 * PGlite test) calls `step()` repeatedly; one step does at most one game action or one network call, so a browser
 * host can space steps with small random delays off the render path.
 */
import { makeRng, type CombatResult, type Rng } from '@game/core';
import type { SetId } from '@game/content';
import {
  CONFIG, catchUpVersusRun, createVersusRun, legalModalAnswers, modalOpen, offerBuyPrice, reduce, versusAutoResolve, versusHeroOffer,
  type Action, type RunState, type VersusSeat,
  versusScoutOf,
} from '@game/sim';
import type { VersusMatch, VersusPrivate, VersusRoom, VersusRoundRow } from './versusRemote';
import type { PreparedCombatSide, VersusSeatScout } from '@game/sim';

/** The slice of the Versus API the bot uses (the browser passes `makeVersusRemote(botClient)`). */
export interface VersusBotApi {
  room(roomId: string): Promise<VersusRoom | null>;
  pressGate(roomId: string): Promise<unknown>;
  heartbeat(roomId: string): Promise<{ serverNow: string; match?: VersusMatch }>;
  match(matchId: string): Promise<VersusMatch | null>;
  myPrivate(matchId: string): Promise<VersusPrivate | null>;
  registerOffer(matchId: string, offer: string[]): Promise<unknown>;
  pickHero(matchId: string, index: number): Promise<unknown>;
  submit(matchId: string, round: number, seq: number, side: PreparedCombatSide, final: boolean, checkpoint: string | null, scout?: VersusSeatScout | null): Promise<unknown>;
  combatReady(matchId: string, round: number): Promise<unknown>;
  introDone(matchId: string): Promise<unknown>;
  requestResume(matchId: string): Promise<unknown>;
  rounds(matchId: string, fromRound?: number): Promise<VersusRoundRow[]>;
  reconcile(matchId: string): Promise<unknown>;
  finalize(matchId: string, round: number, contentRevision: string): Promise<void>;
}

export interface VersusBotOptions {
  /** The bot's own account id (to find its seat). */
  userId: string;
  /** Server-time "now" in ms (the browser host offsets it; the test drives it). */
  now: () => number;
  /** Seed for the bot's choices (deterministic in tests). */
  seed?: number;
  /** Pick a hero (random of three) or let the 20 s timeout pick. Default 'random'. */
  heroPick?: 'random' | 'timeout';
  /** Most shop actions per turn before it ends the turn. Default 8. */
  maxActions?: number;
  /** How long it "watches" each fight before it is back for the next shop, in ms. Default 0. */
  watchMs?: number;
  /** Heartbeat spacing in ms. Default 4000. */
  beatMs?: number;
}

export type BotStepResult = 'acted' | 'idle' | 'done';

export class VersusBotDriver {
  private rng: Rng;
  private matchId: string | null = null;
  private seat: VersusSeat | null = null;
  private priv: VersusPrivate | null = null;
  private introSentFor: string | null = null;
  private watchingRound: number | null = null;
  private watchUntil = 0;
  private offer: string[] | null = null;
  private picked = false;
  /** The bot's own run for the current match. */
  run: RunState | null = null;
  private lockedRound: number | null = null;
  private readyRound: number | null = null;
  private actions = 0;
  private lastBeat = -Infinity;
  private lastFinalize = -Infinity;
  private seq = 0;
  private match: VersusMatch | null = null;
  /** Dev toggle: a "disconnected" bot stops heartbeating and acting (tests the pause / unpause flow). */
  disconnected = false;
  /** Matches this bot finished (for the host / tests). */
  finished: string[] = [];
  /** The current match and the bot's seat in it (the browser host publishes the bot's spectator frames). */
  get currentMatchId(): string | null { return this.matchId; }
  get currentSeat(): VersusSeat | null { return this.seat; }

  constructor(private api: VersusBotApi, private roomId: string, private opts: VersusBotOptions) {
    this.rng = makeRng(opts.seed ?? 0x5eed);
  }

  /** One step of the bot's life. Never throws (a failed call is retried on a later step). */
  async step(): Promise<BotStepResult> {
    if (this.disconnected) return 'idle';
    try {
      return await this.inner();
    } catch {
      return 'idle';
    }
  }

  private async inner(): Promise<BotStepResult> {
    const now = this.opts.now();
    if (now - this.lastBeat >= (this.opts.beatMs ?? 4000)) {
      this.lastBeat = now;
      const hb = await this.api.heartbeat(this.roomId);
      if (hb.match) this.adoptMatch(hb.match);
      const pm = this.match;
      // Back from a disconnect: the bot presses Unpause (the 3-2-1), like a returning player.
      if (pm && pm.paused_at && pm.paused_seat === this.seat && !pm.resume_at) await this.api.requestResume(pm.id).catch(() => undefined);
      if (pm && pm.phase !== 'complete') await this.api.reconcile(pm.id).catch(() => undefined);
      if (!hb.match) {
        // Not in a running match: watch the room for the gate ceremony / the next match.
        const room = await this.api.room(this.roomId);
        if (!room) return 'done';
        const me = room.members.find((m) => m.userId === this.opts.userId);
        if (!me) return 'done';
        if (room.status === 'sealed' && (me.role === 'p1' || me.role === 'p2') && !(me.role === 'p1' ? room.p1_gate : room.p2_gate)) {
          await this.api.pressGate(this.roomId);
          return 'acted';
        }
        if (room.current_match_id && room.current_match_id !== this.matchId) {
          const m = await this.api.match(room.current_match_id);
          if (m) this.adoptMatch(m);
        }
      }
      return 'acted';
    }
    const m = this.match;
    if (!m || !this.seat) return 'idle';
    switch (m.phase) {
      case 'hero_select':
        return this.heroSelect(m);
      case 'shop':
        return this.shop(m, now);
      case 'resolving':
        if (now - this.lastFinalize > 2500) {
          this.lastFinalize = now;
          await this.api.finalize(m.id, m.round, m.content_revision);
          this.match = (await this.api.match(m.id)) ?? m;
          return 'acted';
        }
        return 'idle';
      case 'combat':
        return this.combat(m, now);
      case 'complete':
        if (!this.finished.includes(m.id)) {
          await this.landRound(m); // the deciding fight lands on the bot's run too (no ack: the match is over)
          this.leaveFight();
          this.finished.push(m.id);
        }
        return 'done';
    }
    return 'idle';
  }

  private adoptMatch(m: VersusMatch): void {
    if (m.id !== this.matchId) {
      this.matchId = m.id;
      this.priv = null;
      this.offer = null;
      this.picked = false;
      this.run = null;
      this.lockedRound = null;
      this.readyRound = null;
      this.watchingRound = null; // round numbers restart every match: nothing round-keyed may carry over
      this.watchUntil = 0;
      this.seq = 0;
    }
    this.match = m;
    this.seat = m.p1_user === this.opts.userId ? 'p1' : m.p2_user === this.opts.userId ? 'p2' : null;
  }

  private async heroSelect(m: VersusMatch): Promise<BotStepResult> {
    if (!this.priv) {
      this.priv = await this.api.myPrivate(m.id);
      if (!this.priv) return 'idle';
      this.offer = versusHeroOffer(Number(this.priv.hero_seed), Number(this.priv.run_seed), m.set_id as SetId);
      if (!this.priv.hero_offer) await this.api.registerOffer(m.id, this.offer);
      return 'acted';
    }
    if (!this.picked && (this.opts.heroPick ?? 'random') === 'random') {
      this.picked = true;
      await this.api.pickHero(m.id, this.rng.int(3)).catch(() => undefined);
      this.match = (await this.api.match(m.id)) ?? m;
      return 'acted';
    }
    return 'idle';
  }

  /** The run for this match: built once, caught up through committed rounds (a bot that joined late or reloaded). */
  private async ensureRun(m: VersusMatch): Promise<RunState | null> {
    if (this.run) return this.run;
    if (!this.priv) this.priv = await this.api.myPrivate(m.id);
    if (!this.priv) return null;
    const offer = this.offer ?? versusHeroOffer(Number(this.priv.hero_seed), Number(this.priv.run_seed), m.set_id as SetId);
    const hero = (this.seat === 'p1' ? m.p1_hero : m.p2_hero) ?? offer[this.priv.hero_index ?? 0] ?? offer[0]!;
    let run = createVersusRun(Number(this.priv.run_seed), hero, m.set_id as SetId);
    if (m.round > 1) {
      const rows = await this.api.rounds(m.id, 1);
      run = catchUpVersusRun(run, new Map(rows.map((r) => [r.round, (this.seat === 'p1' ? r.p1_result : r.p2_result) as CombatResult])), Number(m.seed), this.seat!);
    }
    this.run = run;
    return run;
  }

  private async shop(m: VersusMatch, now: number): Promise<BotStepResult> {
    const run = await this.ensureRun(m);
    if (!run || run.phase !== 'recruit' || run.wave !== m.round || this.lockedRound === m.round || m.paused_at) return 'idle';
    // Round 1 waits for the game start to play out on both screens: the bot's own is instant.
    if (!m.shop_deadline) {
      if (this.introSentFor !== m.id) { this.introSentFor = m.id; await this.api.introDone(m.id); return 'acted'; }
      return 'idle';
    }
    // A random action, or End Turn once it has had its fill (or the clock is nearly out).
    const left = m.shop_deadline ? Date.parse(m.shop_deadline) - now : Infinity;
    if (this.actions < (this.opts.maxActions ?? 8) && left > 4000) {
      const next = this.randomAction(run);
      this.actions++;
      if (next) { this.run = next; return 'acted'; }
    }
    // LOCK: every open decision gets a random legal answer, then End Turn parks the side; the run keeps that state.
    const answered = versusAutoResolve(run, this.rng);
    const ended = reduce(answered, { type: 'faceOmen', deferFight: true });
    if (!ended.pendingCombatSide) return 'idle';
    this.seq++;
    this.lockedRound = m.round;
    this.actions = 0;
    this.run = answered;
    await this.api.submit(m.id, m.round, this.seq, ended.pendingCombatSide, true, null, versusScoutOf(answered));
    this.match = (await this.api.match(m.id)) ?? m;
    return 'acted';
  }

  /** One random legal move (or null when nothing it tried was accepted). */
  randomAction(run: RunState): RunState | null {
    const tryAll = (actions: Action[]): RunState | null => {
      for (const a of actions) {
        const next = reduce(run, a);
        if (next !== run) return next;
      }
      return null;
    };
    if (modalOpen(run)) {
      const answers = legalModalAnswers(run);
      return answers.length ? tryAll([answers[this.rng.int(answers.length)]!]) : tryAll([{ type: 'cancelChoice' }]);
    }
    const r = this.rng.next();
    if (r < 0.1) return tryAll([{ type: 'upgrade' }]);
    if (r < 0.2) return tryAll([{ type: 'roll' }]);
    // Play something from hand (a minion needs room), aimed at a random friendly if it needs a target.
    if (run.hand.length && r < 0.55) {
      const card = run.hand[this.rng.int(run.hand.length)]!;
      const aims = run.board.length ? [run.board[this.rng.int(run.board.length)]!.uid] : [];
      return tryAll([{ type: 'play', uid: card.uid }, ...aims.map((t) => ({ type: 'play', uid: card.uid, targetUid: t }) as Action)]);
    }
    // Buy a random affordable minion while board + hand have room.
    if (run.board.length + run.hand.length < CONFIG.boardMax) {
      const affordable = run.shop.filter((o) => offerBuyPrice(run, o).cost <= run.embers);
      if (affordable.length) return tryAll([{ type: 'buy', uid: affordable[this.rng.int(affordable.length)]!.uid }]);
    }
    if (run.hand.length) return tryAll(run.hand.map((c) => ({ type: 'play', uid: c.uid }) as Action));
    return null;
  }

  /** Land round `m.round`'s committed fight on the bot's run (End Turn, land): its run shows the fight, as a player's
   *  does while they watch it (a spectator watching the bot sees the fight, Versus phase 2). False: not in yet. */
  private async landRound(m: VersusMatch): Promise<boolean> {
    const run = this.run;
    if (!run || run.phase !== 'recruit' || run.wave !== m.round) return true; // already landed (or past it)
    const rows = await this.api.rounds(m.id, m.round);
    const row = rows.find((x) => x.round === m.round);
    if (!row) return false;
    const fight = (this.seat === 'p1' ? row.p1_result : row.p2_result) as CombatResult;
    const s = reduce(versusAutoResolve(run, this.rng), { type: 'faceOmen', deferFight: true });
    this.run = reduce(s, { type: 'landCombat', fight: { result: fight, damageTaken: 0 } });
    return true;
  }

  /** Done watching: settle the fight and go back to the shop. */
  private leaveFight(): void {
    const run = this.run;
    if (!run || run.phase !== 'combat') return;
    this.run = reduce(reduce(run, { type: 'settleCombat' }), { type: 'resolveCombat' });
  }

  private async combat(m: VersusMatch, now: number): Promise<BotStepResult> {
    const run = await this.ensureRun(m);
    if (!run || this.readyRound === m.round) return 'idle';
    // It "watches" the fight for a while, like a player, before it is back.
    if (this.watchingRound !== m.round) {
      if (!(await this.landRound(m))) return 'idle';
      this.watchingRound = m.round;
      this.watchUntil = now + (this.opts.watchMs ?? 0);
    }
    if (now < this.watchUntil) return 'idle';
    this.leaveFight();
    this.readyRound = m.round;
    await this.api.combatReady(m.id, m.round);
    this.match = (await this.api.match(m.id)) ?? m;
    return 'acted';
  }
}
