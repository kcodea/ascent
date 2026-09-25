import { SPEC } from './runeforgeEntrance/runeforgeEntranceConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the Runeforge ENTRANCE (owner ask 2026-09-24): the tablets' drop, squash and settle, the landing
 * dust, the shade, embers and glow sweep, the Epic multipliers, and the four sound cues (land, dust, ignite,
 * epicFlare), each with its clip, gain and offset. ▶ Play (Basic) / ▶ Play (Epic) open a sample forge over the
 * current screen, so there is no need to play to the forge turn. Production always plays the baked defaults.
 */
export function RuneforgeEntranceTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
