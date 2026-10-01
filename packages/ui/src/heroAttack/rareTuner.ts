/**
 * THE RARE ATTACK TUNERS (added 2026-09-29 with Coin Flick, Boomerang, Bubble Pop and Backstab): one builder for the
 * four DEV panels, in the shared layout every attack tuner uses since #1843 (Copy JSON / Reset / Play row at the TOP;
 * no Speed or Reduced motion buttons; the "Attack style" dev override first). A Rare has TWO visual tiers, so its
 * per-tier dials are two groups (Small: shared tiers I-II; Big: III-IV and every knockout), not four.
 *
 * The Play buttons run the REAL runner between the two real hero portraits (works from the shop), in either direction,
 * at the same four blows every attack tuner offers (3 / 8 play Small; 12 / 40 play Big). A preview never touches the
 * run. Production plays the baked defaults.
 */
import { clipNames } from '../sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from '../heroBlast/heroAttackStyle';
import { boardOfDamage, playAttackDemo } from './attackDemo';
import type { ConfigStore } from './configStore';
import type { HeroAttackHandle, HeroAttackOptions } from './options';
import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';

/** [label, unit, hint, group]. A group starting "Sound: " gets that cue's clip picker above its dials. */
export type RareGlobalSpec = [string, TunerUnit | undefined, string, string];
/** [label, unit, hint] for a per-level dial (the group is the level's). */
export type RareLevelSpec = [string, TunerUnit | undefined, string];

export interface RareTunerDef<C extends object> {
  /** FROZEN panel id (indexes the panel's dragged position). */
  id: string;
  title: string;
  store: ConfigStore<C>;
  defaults: C;
  ranges: Record<string, readonly [number, number, number]>;
  globals: Record<string, RareGlobalSpec>;
  levels: readonly string[];
  levelNames: Record<string, string>;
  suffixes: readonly string[];
  levelSpecs: Record<string, RareLevelSpec>;
  colors: readonly [string, string, string][];
  /** Sound group -> its clip key. */
  clipOf: Record<string, string>;
  note: () => string;
  play: (o: HeroAttackOptions) => HeroAttackHandle;
  /** The verb for the Play buttons' hints ("flicks a coin at"). */
  verb: string;
  /** What each preview blow plays, for the hints. */
  smallHint: string;
  bigHint: string;
  /**
   * A FOUR-tier attack (a Legendary on this builder, e.g. the Basketball): what each of the four preview blows plays,
   * I / II / III / IV. Overrides the Small / Big hints on those buttons.
   */
  tierHints?: readonly [string, string, string, string];
}

type Values<C> = C & { attackStyle: string };

/** A preview's blow, and (the capture rig) a manual frame source so a still can be taken at any beat. */
export interface DemoPlayOpts { damage?: number; parts?: number; frames?: HeroAttackOptions['frames']; sound?: boolean; safety?: boolean }

function clipOptions(): string[] {
  let names: string[] = [];
  try { names = clipNames(); } catch { /* no audio here */ }
  return ['', ...names];
}

export function rareTunerSpec<C extends object>(d: RareTunerDef<C>): { spec: TunerSpec<Values<C>>; demo: (side: 'player' | 'opp', opts?: DemoPlayOpts) => Promise<HeroAttackHandle | null> } {
  type Key = Extract<keyof Values<C>, string>;
  const out: TunerControl<Key>[] = [{
    key: 'attackStyle' as Key, label: 'Attack style', kind: 'select', options: DEV_HERO_ATTACK_CHOICES, group: 'Style',
    optionLabels: DEV_HERO_ATTACK_LABELS,
    hint: 'Which hero attack real fights play in this dev build, for both sides. Auto = what a player sees.', min: 0, max: 0, step: 0,
  }];
  const push = (key: string, [label, unit, hint, group]: RareGlobalSpec): void => {
    const [min, max, step] = d.ranges[key]!;
    out.push({ key: key as Key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(d.globals);
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const l of d.levels) {
    for (const sfx of d.suffixes) {
      const [label, unit, hint] = d.levelSpecs[sfx]!;
      const key = `${l}${sfx}`;
      const [min, max, step] = d.ranges[key]!;
      out.push({ key: key as Key, label, unit, hint, group: d.levelNames[l], min, max, step });
    }
  }
  for (const [ck, cl, ch] of d.colors) out.push({ key: ck as Key, label: cl, hint: ch, group: 'Colours', kind: 'color', min: 0, max: 0, step: 0 });
  const clips = clipOptions();
  let lastGroup = '';
  for (const [key, spec] of globals) {
    const group = spec[3];
    if (!group.startsWith('Sound')) continue;
    const clipKey = d.clipOf[group];
    if (clipKey && group !== lastGroup) {
      out.push({ key: clipKey as Key, label: `${group.replace('Sound: ', '')}: clip`, hint: 'Which clip this cue plays. (none) = silent.', group, kind: 'select', options: clips, optionLabels: { '': '(none)' }, min: 0, max: 0, step: 0 });
    }
    lastGroup = group;
    push(key, spec);
  }

  let live: HeroAttackHandle | null = null;
  const demo = (side: 'player' | 'opp', opts: DemoPlayOpts = {}): Promise<HeroAttackHandle | null> => {
    live?.cancel();
    const cfg = d.store.get() as unknown as { previewDamage: number; previewParts: number };
    return playAttackDemo(side, d.play, {
      board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts), speed: 1, frames: opts.frames, sound: opts.sound, safety: opts.safety,
    }, () => { live = null; }).then((h) => { live = h; return h; });
  };

  const spec: TunerSpec<Values<C>> = {
    id: d.id,
    title: d.title,
    note: d.note,
    read: () => ({ ...d.store.get(), attackStyle: devHeroAttackChoice() }),
    write: (key, value) => d.store.set(key as keyof C, value),
    writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else d.store.set(key as keyof C, value); },
    reset: () => { d.store.reset(); setDevHeroAttackChoice('auto'); },
    defaults: { ...d.defaults, attackStyle: 'auto' },
    controls: out,
    copy: () => d.store.json(),
    copyLabel: 'Copy JSON',
    buttonsOnTop: true,
    actions: [
      { label: '▶ You attack', hint: `Your hero ${d.verb} the foe for the preview damage.`, run: () => { void demo('player'); } },
      { label: '▶ Foe attacks', hint: `The foe ${d.verb} your hero for the preview damage.`, run: () => { void demo('opp'); } },
      { label: '▶ Small (3)', hint: `Your hero attacks for 3 (shared Tier I): ${d.tierHints?.[0] ?? d.smallHint}`, run: () => { void demo('player', { damage: 3, parts: 2 }); } },
      { label: '▶ Tier II (8)', hint: `Your hero attacks for 8 (shared Tier II): ${d.tierHints?.[1] ?? `still ${d.smallHint}`}`, run: () => { void demo('player', { damage: 8, parts: 3 }); } },
      { label: '▶ Medium (12)', hint: `Your hero attacks for 12 (shared Tier III): ${d.tierHints?.[2] ?? d.bigHint}`, run: () => { void demo('player', { damage: 12, parts: 4 }); } },
      { label: '▶ Huge (40)', hint: `Your hero attacks for 40 (shared Tier IV, as a knockout plays): ${d.tierHints?.[3] ?? d.bigHint}`, run: () => { void demo('player', { damage: 40, parts: 7 }); } },
      { label: '▶ Foe small (3)', hint: 'The foe attacks your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
      { label: '▶ Foe tier II (8)', hint: 'The foe attacks your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
      { label: '▶ Foe medium (12)', hint: 'The foe attacks your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
      { label: '▶ Foe huge (40)', hint: 'The foe attacks your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
    ],
  };
  return { spec, demo };
}
