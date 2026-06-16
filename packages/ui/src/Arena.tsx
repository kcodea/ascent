import { useEffect, useMemo, useState } from 'react';
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

/** Fold the event log up to `upto` into the live board state — a pure function of the step index. */
function computeFrame(
  initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] },
  events: CombatEvent[],
  upto: number,
): { player: UnitFrame[]; enemy: UnitFrame[] } {
  const player = initial.player.map(fromSnap);
  const enemy = initial.enemy.map(fromSnap);
  const find = (uid: string) => player.find((u) => u.uid === uid) ?? enemy.find((u) => u.uid === uid);
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
    } else if (e.type === 'buff') {
      const u = find(e.target);
      if (u) { u.attack += e.attack; u.health += e.health; }
    } else if (e.type === 'summon') {
      const arr = e.side === 'player' ? player : enemy;
      arr.splice(Math.min(e.index, arr.length), 0, fromSnap(e.minion));
    }
  }
  return { player, enemy };
}

// Per-event beat lengths (ms). SPEED scales the whole sequence — higher = slower.
const SPEED = 1.2;
const DELAY: Record<string, number> = {
  sc: 760, attack: 340, dmg: 230, shield: 520, shieldUp: 480, poison: 520, reborn: 560, death: 360, summon: 380, buff: 320,
};
const FLOAT_MS = 1000;
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
  u, side, anim, floats,
}: {
  u: UnitFrame;
  side: 'foe' | 'you';
  anim?: string;
  floats?: { id: number; text: string; kind: string }[];
}) {
  const cls = ['unit', side, u.alive ? '' : 'dead', u.divineShield ? 'ds' : '', anim ?? ''].filter(Boolean).join(' ');
  const view: CardView = {
    name: u.name, tribe: u.tribe, attack: u.attack, health: Math.max(0, u.health),
    keywords: u.keywords, text: CARD_INDEX[u.cardId]?.text ?? '',
  };
  return (
    <div className={cls}>
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
  const [step, setStep] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const done = step >= events.length;

  useEffect(() => {
    if (done) return;
    const e = events[step];
    const id = window.setTimeout(() => setStep((k) => k + 1), (DELAY[e.type] ?? 300) * SPEED);
    return () => window.clearTimeout(id);
  }, [step, done, events]);

  // Spawn a floating number when an event lands; it dissipates on its own timer.
  useEffect(() => {
    const f = floatFor(step > 0 ? events[step - 1] : undefined);
    if (!f) return;
    const id = step;
    setFloats((arr) => (arr.some((x) => x.id === id) ? arr : [...arr, { id, ...f }]));
    const t = window.setTimeout(() => setFloats((arr) => arr.filter((x) => x.id !== id)), FLOAT_MS);
    return () => window.clearTimeout(t);
  }, [step, events]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    if (!combat) return m;
    for (const u of [...combat.initial.player, ...combat.initial.enemy]) m.set(u.uid, u.name);
    for (const e of combat.events) if (e.type === 'summon') m.set(e.minion.uid, e.minion.name);
    return m;
  }, [combat]);

  const frame = useMemo(
    () => (combat ? computeFrame(combat.initial, events, step) : { player: [], enemy: [] }),
    [combat, events, step],
  );

  if (!combat) return null;

  const anims = animFor(step > 0 ? events[step - 1] : undefined);
  let log = 'The boards take their positions…';
  for (let i = Math.min(step, events.length) - 1; i >= 0; i--) {
    const line = narrate(events[i], names);
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
          <button className="skip" onClick={() => setStep(events.length)}>
            <Icon name="sword" />Skip
          </button>
        )}
      </div>

      <div className="ascene">
        <div className="side foe"><span>The Omen</span><span className="rl" /></div>
        <div className="line foe">
          {frame.enemy.map((u) => (
            <Unit key={u.uid} u={u} side="foe" anim={anims[u.uid]} floats={floatsFor(u.uid)} />
          ))}
        </div>
        <div className="clash"><span className="ln" /><span className="vs disp">VS</span><span className="ln" /></div>
        <div className="line you">
          {frame.player.map((u) => (
            <Unit key={u.uid} u={u} side="you" anim={anims[u.uid]} floats={floatsFor(u.uid)} />
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
