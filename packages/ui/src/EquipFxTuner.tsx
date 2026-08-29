import {
  EQUIP_FX_DEFAULTS, EQUIP_FX_RANGES, getEquipFxConfig, resetEquipFxConfig, setEquipFxValue,
  type EquipFxConfig,
} from './equipFxConfig';
import { TunerPanel } from './TunerPanel';
import { sfx } from './sfx';
import { canPlayDefs, playDef } from './fx/playDef';
import type { TunerAction, TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for EQUIPPING — the authored `equipment-spark` burst and the metallic clang (owner ask
 * 2026-08-28: "add a tuner for this so that I can time the animation and SFX together as best as possible").
 *
 * The thing being judged is RELATIVE timing: which of the source burst, the slot burst and the clang leads,
 * and by how much. So the dials are three delays off one shared cue, and each element has its own on/off so a
 * pair can be isolated — hearing the clang against the slot burst alone is how you find the seat.
 *
 * The clang schedules on the AUDIO clock (`playSample`'s own delay), not a `setTimeout`, so what you tune here
 * holds at any frame rate rather than drifting when the main thread is busy.
 *
 * The Test buttons fire at the CENTRE OF THE SCREEN rather than on a real minion — an equip needs an Equip
 * minion and a slot, and waiting for one to judge a 140ms offset is the kind of friction that stops a tuner
 * being used. Judge the seat here, then confirm it on a real play.
 */
const SPECS: Record<keyof EquipFxConfig, [string, TunerUnit | undefined, string, string]> = {
  sourceDelayMs: ['Source burst', 'ms', 'When the burst fires on the MINION granting the Equipment.', 'Timing'],
  slotDelayMs: ['Slot burst', 'ms', 'When the burst fires on the Equipment BUTTON — the icon arriving.', 'Timing'],
  sfxDelayMs: ['Clang', 'ms', 'When the metallic clang plays. Scheduled on the audio clock, so it cannot drift from the visual.', 'Timing'],
  staggerMs: ['Per-source stagger', 'ms', 'Gap between sources when several Equip minions re-equip at once, so a rebuild reads left-to-right instead of as one blur.', 'Timing'],

  sourceOn: ['Source burst', undefined, '1 plays the burst on the source minion, 0 silences it — for judging the slot and clang alone.', 'On / off'],
  slotOn: ['Slot burst', undefined, '1 plays the burst on the Equipment button, 0 silences it.', 'On / off'],
  sfxOn: ['Clang', undefined, '1 plays the clang, 0 silences it — for judging the visual alone.', 'On / off'],
  reequipSparkOn: ['Spark on re-equip', undefined, '1 plays the full spark for every surviving source at Start of Turn; 0 leaves the rebuild as the quieter ring only. Off by default — a full burst per source every turn is a lot of screen for a bookkeeping step.', 'On / off'],
};

/** Declaration order IS render order; controls sharing a group render under its heading. */
const ORDER: (keyof EquipFxConfig)[] = [
  'sourceDelayMs', 'slotDelayMs', 'sfxDelayMs', 'staggerMs',
  'sourceOn', 'slotOn', 'sfxOn', 'reequipSparkOn',
];

const controls: TunerControl<Extract<keyof EquipFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = EQUIP_FX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

/** Fire the whole cue at the screen centre, exactly as an equip does — same delays, same clock. */
function testEquip(): void {
  const cfg = getEquipFxConfig();
  const at = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  // The slot's real position when one is on screen, so the two halves are judged at their true separation.
  const slotEl = document.querySelector<HTMLElement>('.equippanel .heropowerbtn');
  const r = slotEl?.getBoundingClientRect();
  const slot = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: at.x + 220, y: at.y + 160 };
  const spark = (p: { x: number; y: number }, delay: number): void => {
    if (!canPlayDefs()) return;
    window.setTimeout(() => { playDef('equipment-spark', { source: p, target: p, cursor: p }); }, delay);
  };
  if (cfg.sourceOn) spark(at, cfg.sourceDelayMs);
  if (cfg.slotOn) spark(slot, cfg.slotDelayMs);
  if (cfg.sfxOn) sfx.equipClang(cfg.sfxDelayMs);
}

const actions: TunerAction[] = [
  {
    label: '▶ equip',
    hint: 'Fires the whole cue — source burst, slot burst and clang — at their tuned offsets.',
    run: testEquip,
  },
  {
    label: '▶ clang only',
    hint: 'The sound on its own, to hear where its attack actually lands.',
    run: () => sfx.equipClang(0),
  },
];

export const SPEC: TunerSpec<EquipFxConfig> = {
  id: 'equipfx',                    // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Equip FX & Clang',
  note: 'dev · next equip · drag',
  read: getEquipFxConfig,
  write: setEquipFxValue,
  reset: resetEquipFxConfig,
  defaults: EQUIP_FX_DEFAULTS,
  controls,
  actions,
};

export function EquipFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
