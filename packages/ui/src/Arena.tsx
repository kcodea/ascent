import { useEffect, useMemo, useRef, useState } from 'react';
import type { CombatEvent, Keyword, MinionSnapshot, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { THREATS } from '@game/sim';
import { Card, type CardView } from './Card';
import { Icon } from './Icon';
import { useGame } from './store';

interface UnitFrame {
  uid: string;
  cardId: string;
  name: string;
  tribe: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  divineShield: boolean;
  alive: boolean;
}

interface Float {
  id: number;
  uid: string;
  text: string;
  kind: string;
}

const fromSnap = (s: MinionSnapshot): UnitFrame => ({
  uid: s.uid, cardId: s.cardId, name: s.name, tribe: s.tribe, attack: s.attack, health: s.health,
  keywords: [...s.keywords], divineShield: s.keywords.includes('DS'), alive: true,
});

/**
 * Fold the event log up to `upto` into the live board state. Deaths from *before*
 * the current beat (index < `beatStart`) are removed outright; a minion dying in
 * the current beat is kept one beat (rendered with its death pop, no grey) so the
 * killing blow reads, then it's gone next beat.
 */
function computeFrame(
  initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] },
  events: CombatEvent[],
  upto: number,
  beatStart: number,
): { player: UnitFrame[]; enemy: UnitFrame[] } {
  const player = initial.player.map(fromSnap);
  const enemy = initial.enemy.map(fromSnap);
  const find = (uid: string) => player.find((u) => u.uid === uid) ?? enemy.find((u) => u.uid === uid);
  const gone = new Set<string>();
  for (let i = 0; i < Math.min(upto, events.length); i++) {
    const e = events[i];
    if (e.type === 'dmg') {
      const u = find(e.target);
      if (u) u.health = e.remainingHp;
    } else if (e.type === 'shield') {
      const u = find(e.target);
      if (u) { u.divineShield = false; u.keywords = u.keywords.filter((k) => k !== 'DS'); }
    } else if (e.type === 'shieldUp') {
      const u = find(e.target);
      if (u) { u.divineShield = true; if (!u.keywords.includes('DS')) u.keywords.push('DS'); }
    } else if (e.type === 'poison') {
      const u = find(e.target);
      if (u) u.health = 0;
    } else if (e.type === 'reborn') {
      const u = find(e.target);
      if (u) { u.health = e.hp; u.keywords = u.keywords.filter((k) => k !== 'R'); }
    } else if (e.type === 'death') {
      const u = find(e.target);
      if (u) { u.alive = false; u.health = 0; }
      if (i < beatStart) gone.add(e.target);
    } else if (e.type === 'buff') {
      const u = find(e.target);
      if (u) { u.attack += e.attack; u.health += e.health; }
    } else if (e.type === 'summon') {
      const arr = e.side === 'player' ? player : enemy;
      arr.splice(Math.min(e.index, arr.length), 0, fromSnap(e.minion));
    }
  }
  return { player: player.filter((u) => !gone.has(u.uid)), enemy: enemy.filter((u) => !gone.has(u.uid)) };
}

// Per-beat lengths (ms), keyed by the beat's first event. SPEED scales it all
// (higher = slower; 1.5 is ~25% slower than the previous 1.2).
const SPEED = 1.5;
const DELAY: Record<string, number> = {
  // action beats (the wind-up / cast)
  attack: 340, sc: 720, summon: 440, buff: 420, reborn: 560,
  // result beats (the impact — keyed by the first result event)
  dmg: 360, shield: 460, shieldUp: 460, poison: 480, death: 320,
};
const FLOAT_MS = 1250;

/**
 * Combat beats. An action (attack / SC / summon / buff / reborn) is its own beat —
 * the wind-up — and the run of result events it caused (damage, shields, poison,
 * deaths) is the *next* beat, where everything lands at once. So an attacker lunges
 * in (beat 1), then it and its target take damage together (beat 2).
 */
const RESULT_TYPES = new Set(['dmg', 'shield', 'shieldUp', 'poison', 'death']);
interface Beat {
  start: number;
  end: number;
  primary: CombatEvent;
}
function buildBeats(events: CombatEvent[]): Beat[] {
  const beats: Beat[] = [];
  let i = 0;
  while (i < events.length) {
    const start = i;
    if (RESULT_TYPES.has(events[i]!.type)) {
      while (i < events.length && RESULT_TYPES.has(events[i]!.type)) i++; // group the impact
    } else {
      i++; // a single action
    }
    beats.push({ start, end: i, primary: events[start]! });
  }
  return beats;
}
const VERDICT = { win: 'HELD', lose: 'BROKEN', draw: 'STALEMATE' } as const;
const WHY = {
  win: 'The wave breaks against your warband.',
  lose: 'The omen overwhelmed your warband.',
  draw: 'Both boards fell — a grim stalemate.',
} as const;
/** The transient animation class for the unit the active event acts on. */
function animFor(e: CombatEvent | undefined): Record<string, string> {
  if (!e) return {};
  switch (e.type) {
    case 'attack': return { [e.attacker]: 'attacking' };
    case 'dmg': return { [e.target]: 'struck' };
    case 'shield': return { [e.target]: 'flare' };
    case 'shieldUp': return { [e.target]: 'flare' };
    case 'poison': return { [e.target]: 'poisoned' };
    case 'reborn': return { [e.target]: 'flare' };
    case 'buff': return { [e.target]: 'flare' };
    case 'sc': return { [e.source]: 'flare' };
    case 'death': return { [e.target]: 'dying' };
    default: return {};
  }
}

/** A floating number/glyph over the unit the active event acts on. */
function floatFor(e: CombatEvent | undefined): { uid: string; text: string; kind: string } | null {
  if (!e) return null;
  switch (e.type) {
    case 'dmg': return { uid: e.target, text: `−${e.amount}`, kind: 'dmg' };
    case 'poison': return { uid: e.target, text: '☠', kind: 'poison' };
    case 'shield': return { uid: e.target, text: '◇', kind: 'shield' };
    case 'shieldUp': return { uid: e.target, text: '◇', kind: 'shieldup' };
    case 'reborn': return { uid: e.target, text: '♻', kind: 'reborn' };
    case 'buff': return { uid: e.target, text: `+${e.attack}/+${e.health}`, kind: 'buff' };
    default: return null;
  }
}

function narrate(e: CombatEvent, names: Map<string, string>): string | null {
  const n = (uid: string) => names.get(uid) ?? 'a minion';
  switch (e.type) {
    case 'sc': return e.text;
    case 'attack': return `${n(e.attacker)} strikes ${n(e.defender)}.`;
    case 'shield': return '◇ A Divine Shield absorbs the blow!';
    case 'shieldUp': return `◇ ${n(e.target)} gains a Divine Shield.`;
    case 'poison': return `☠ Poison! ${n(e.target)} is destroyed.`;
    case 'reborn': return `♻ ${n(e.target)} is Reborn at 1 Health.`;
    case 'death': return `${n(e.target)} falls.`;
    case 'summon': return `${e.minion.name} joins the fray.`;
    case 'buff': return `${n(e.target)} grows +${e.attack}/+${e.health}.`;
    default: return null;
  }
}

/** A combat unit — the same Card as recruit, wrapped for animations, floats, and the DS ring. */
function Unit({
  u, side, anim, floats, lunge,
}: {
  u: UnitFrame;
  side: 'foe' | 'you';
  anim?: string;
  floats?: { id: number; text: string; kind: string }[];
  /** Inline transform that slides the attacker into its target. */
  lunge?: string;
}) {
  const cls = ['unit', side, u.divineShield ? 'ds' : '', anim ?? ''].filter(Boolean).join(' ');
  const view: CardView = {
    name: u.name, tribe: u.tribe, attack: u.attack, health: Math.max(0, u.health),
    keywords: u.keywords, text: CARD_INDEX[u.cardId]?.text ?? '', tier: CARD_INDEX[u.cardId]?.tier,
  };
  return (
    <div className={cls} data-uid={u.uid} style={lunge ? { transform: lunge, zIndex: 10 } : undefined}>
      <Card card={view} />
      {floats?.map((f) => (
        <span key={f.id} className={`float ${f.kind}`}>{f.text}</span>
      ))}
    </div>
  );
}

export function Arena() {
  const run = useGame((s) => s.run);
  const dispatch = useGame((s) => s.dispatch);
  const combat = run.lastCombat;
  const events = combat?.events ?? [];
  const beats = useMemo(() => buildBeats(events), [events]);
  const [beatIdx, setBeatIdx] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const lungeRef = useRef<{ uid: string; transform: string } | null>(null);
  const done = beatIdx >= beats.length;

  // Advance one beat at a time (a beat = an action + all its result events).
  useEffect(() => {
    if (beatIdx >= beats.length) return;
    const beat = beats[beatIdx]!;
    const id = window.setTimeout(() => setBeatIdx((k) => k + 1), (DELAY[beat.primary.type] ?? 300) * SPEED);
    return () => window.clearTimeout(id);
  }, [beatIdx, beats]);

  // Spawn floats for every damage/poison/shield in the beat just resolved — all at once.
  useEffect(() => {
    if (beatIdx === 0) return;
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    const spawned: Float[] = [];
    for (let i = beat.start; i < beat.end; i++) {
      const f = floatFor(events[i]);
      if (f) spawned.push({ id: i, ...f });
    }
    if (spawned.length === 0) return;
    setFloats((arr) => [...arr, ...spawned.filter((s) => !arr.some((x) => x.id === s.id))]);
    const ids = new Set(spawned.map((s) => s.id));
    const t = window.setTimeout(() => setFloats((arr) => arr.filter((x) => !ids.has(x.id))), FLOAT_MS);
    return () => window.clearTimeout(t);
  }, [beatIdx, beats, events]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    if (!combat) return m;
    for (const u of [...combat.initial.player, ...combat.initial.enemy]) m.set(u.uid, u.name);
    for (const e of combat.events) if (e.type === 'summon') m.set(e.minion.uid, e.minion.name);
    return m;
  }, [combat]);

  const processedEnd = beatIdx === 0 ? 0 : beats[beatIdx - 1]!.end;
  // Mid-replay, keep the current beat's dying minions one beat; once done, drop
  // every dead minion so the result shows only survivors.
  const beatStart = done ? processedEnd : beatIdx === 0 ? 0 : beats[beatIdx - 1]!.start;
  const frame = useMemo(
    () => (combat ? computeFrame(combat.initial, events, processedEnd, beatStart) : { player: [], enemy: [] }),
    [combat, events, processedEnd, beatStart],
  );

  if (!combat) return null;

  const currentBeat = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
  const anims: Record<string, string> = {};
  if (currentBeat) {
    for (let i = currentBeat.start; i < currentBeat.end; i++) Object.assign(anims, animFor(events[i]));
  }

  // The attacker slides in on its action beat and stays planted through the
  // following impact beat, then retracts. Cached so the impact beat doesn't
  // recompute off the already-transformed element.
  const prevBeat = beatIdx > 1 ? beats[beatIdx - 2] : undefined;
  if (currentBeat?.primary.type === 'attack') {
    const pe = currentBeat.primary;
    const aEl = document.querySelector(`.ascene [data-uid="${pe.attacker}"]`);
    const dEl = document.querySelector(`.ascene [data-uid="${pe.defender}"]`);
    if (aEl && dEl) {
      const ar = aEl.getBoundingClientRect();
      const dr = dEl.getBoundingClientRect();
      const dx = dr.left + dr.width / 2 - (ar.left + ar.width / 2);
      const dy = dr.top + dr.height / 2 - (ar.top + ar.height / 2);
      lungeRef.current = {
        uid: pe.attacker,
        transform: `translate(${Math.round(dx * 0.55)}px, ${Math.round(dy * 0.55)}px) scale(1.04)`,
      };
    }
  } else if (!(currentBeat && RESULT_TYPES.has(currentBeat.primary.type) && prevBeat?.primary.type === 'attack')) {
    lungeRef.current = null; // not an attack, and not the impact right after one
  }
  let lungeUid: string | null = null;
  let lungeTransform: string | undefined;
  if (lungeRef.current) {
    lungeUid = lungeRef.current.uid;
    lungeTransform = lungeRef.current.transform;
    anims[lungeUid] = 'attacking';
  }

  let log = 'The boards take their positions…';
  for (let i = processedEnd - 1; i >= 0; i--) {
    const line = narrate(events[i]!, names);
    if (line) { log = line; break; }
  }
  const floatsFor = (uid: string) => floats.filter((f) => f.uid === uid);

  return (
    <div className="arena">
      <div className="atop">
        <div className="ares"><Icon name="heart" />Resolve {run.resolve}</div>
        <h1 className="disp">THE WAVE BREAKS</h1>
        <div className="asub">Wave {run.wave} · {THREATS[run.threat].name}</div>
        {!done && (
          <button className="skip" onClick={() => setBeatIdx(beats.length)}>
            <Icon name="sword" />Skip
          </button>
        )}
      </div>

      <div className="ascene">
        <div className="side foe"><span>The Omen</span><span className="rl" /></div>
        <div className="line foe">
          {frame.enemy.map((u) => (
            <Unit key={u.uid} u={u} side="foe" anim={anims[u.uid]} floats={floatsFor(u.uid)} lunge={u.uid === lungeUid ? lungeTransform : undefined} />
          ))}
        </div>
        <div className="clash"><span className="ln" /><span className="vs disp">VS</span><span className="ln" /></div>
        <div className="line you">
          {frame.player.map((u) => (
            <Unit key={u.uid} u={u} side="you" anim={anims[u.uid]} floats={floatsFor(u.uid)} lunge={u.uid === lungeUid ? lungeTransform : undefined} />
          ))}
        </div>
        <div className="side you"><span className="rl" /><span>Your Warband</span></div>
      </div>

      <div className="alog">{log}</div>

      {done && (
        <div className="result">
          <span className={`verdict disp ${combat.result}`}>{VERDICT[combat.result]}</span>
          <span className="rres">{combat.result === 'lose' ? `−${combat.playerDamage} Resolve` : '−0 Resolve'}</span>
          <span className="rwhy">{WHY[combat.result]}</span>
          <button className="climb" onClick={() => dispatch({ type: 'resolveCombat' })}>
            <Icon name="up" />Climb On
          </button>
        </div>
      )}
    </div>
  );
}
