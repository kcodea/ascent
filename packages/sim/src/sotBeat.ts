/**
 * THE START OF TURN BEAT RECORDER (R-SOT-BEAT-01; owner 2026-09-27, verbatim: "yes they all need their own beat, and the
 * timer/turn shouldnt start until after they complete. also, they need to wait until the transition back from combat
 * finishes.").
 *
 * Every Start of Turn effect resolves inside `resolveCombat` (`advanceCombat`), which the Shop dispatches while the
 * return curtain fully covers the scene. So each source is run through `recordSotBeat`, which measures what the source
 * changed and records it as ONE beat on the Start-of-Turn beat channel (`RunState.sotBeatFx`): the UI plays the beats
 * one after another, in this (sim) order, once the wipe has come to rest (`packages/ui/src/sotBeats.ts`).
 *
 * READ-ONLY by construction: the recorder takes snapshots and diffs them, it never draws from the RNG, reorders, or
 * writes anything the sim reads back. The run state after Start of Turn is byte-identical with or without it, apart
 * from the presentation-only `sotBeatFx` / `sotBeatFxSeq` / `sotRuneProcs` fields. A DIFF (not per-effect wiring) is
 * what makes "every Start of Turn effect gets its own beat" hold for a source added later without touching the UI.
 */
import type { RunState, SotBeatFx, SotBeatSource } from './state';

/** How many Discovers are open or waiting (the thing a Discover-raising source changes). */
function discoversOf(s: RunState): number {
  return (s.discover ? 1 : 0) + (s.discoverQueue?.length ?? 0);
}

/**
 * Run one Start of Turn source and record it as its own beat when it did anything (or `always`: a board minion's
 * Start of Turn fired even when its payoff is invisible, e.g. Equipment Charger's charge — the pulse is the beat).
 */
export function recordSotBeat(s: RunState, source: SotBeatSource, run: () => void, opts?: { always?: boolean }): void {
  const board = new Map(s.board.map((c) => [c.uid, { attack: c.attack, health: c.health, golden: !!c.golden }]));
  const hand = new Set(s.hand.map((c) => c.uid));
  const shop = new Set(s.shop.map((o) => o.uid));
  const embers = s.embers;
  const discovers = discoversOf(s);
  const procsBefore = s.runeProcs ?? {};
  const buffStart = s.recruitBuffFx.length;
  const equipStart = (s.equipFx ?? []).length;
  run();
  const gains: SotBeatFx['gains'] = [];
  const gilds: string[] = [];
  const summons: string[] = [];
  for (const c of s.board) {
    const p = board.get(c.uid);
    if (!p) { if (!hand.has(c.uid)) summons.push(c.uid); continue; }
    const da = c.attack - p.attack, dh = c.health - p.health;
    if (da > 0 || dh > 0) gains.push({ uid: c.uid, attack: Math.max(0, da), health: Math.max(0, dh) });
    if (c.golden && !p.golden) gilds.push(c.uid);
  }
  const handGrants = s.hand.filter((c) => !hand.has(c.uid) && !board.has(c.uid)).map((c) => c.uid);
  const shopAdds = s.shop.filter((o) => !shop.has(o.uid)).map((o) => o.uid);
  const gold = Math.max(0, s.embers - embers);
  const discovered = Math.max(0, discoversOf(s) - discovers);
  const procs: Record<string, number> = {};
  for (const [id, n] of Object.entries(s.runeProcs ?? {})) {
    const d = n - (procsBefore[id] ?? 0);
    if (d > 0) procs[id] = d;
  }
  const buffFx = s.recruitBuffFx.slice(buffStart);
  const equipFx = (s.equipFx ?? []).slice(equipStart);
  const hasProcs = Object.keys(procs).length > 0;
  const did = gains.length > 0 || gilds.length > 0 || summons.length > 0 || handGrants.length > 0 || shopAdds.length > 0
    || gold > 0 || discovered > 0 || hasProcs || equipFx.length > 0;
  if (!did && !opts?.always) return;
  pushSotBeat(s, {
    source,
    gains,
    ...(handGrants.length ? { handGrants } : {}),
    ...(summons.length ? { summons } : {}),
    ...(shopAdds.length ? { shopAdds } : {}),
    ...(gilds.length ? { gilds } : {}),
    ...(gold > 0 ? { gold } : {}),
    ...(discovered > 0 ? { discovers: discovered } : {}),
    ...(hasProcs ? { procs } : {}),
    ...(buffFx.length ? { buffFx } : {}),
    ...(equipFx.length ? { equipFx } : {}),
  });
}

/** Append one beat to the channel (and fold its rune pulses into `sotRuneProcs`, which the badges hold back). */
export function pushSotBeat(s: RunState, beat: SotBeatFx): void {
  (s.sotBeatFx ??= []).push(beat);
  s.sotBeatFxSeq = (s.sotBeatFxSeq ?? 0) + 1;
  if (beat.procs) {
    const acc = { ...(s.sotRuneProcs ?? {}) };
    for (const [id, n] of Object.entries(beat.procs)) acc[id] = (acc[id] ?? 0) + n;
    s.sotRuneProcs = acc;
  }
}
