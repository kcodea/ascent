/**
 * THE ARCHIVED-CONTENT CONTRACT, applied to a LEGACY QUEST RUN.
 *
 * Owner ruling 2026-08-28 archived the quest system. Archiving is not deleting, and the difference is only
 * real if a run recorded BEFORE the archive still works. Someone is mid-run on Fi right now with a hero quest
 * at 14/18 progress and a pinned board for every wave they have fought; the archive must not cost them that
 * run, and a replay of it must not throw.
 *
 * This is the same guarantee `ARCHIVED_CARDS` / `ARCHIVED_RUNES` make — resolvable by id, member of no pool —
 * and the reason the archive gates the OFFER PRODUCER (`questOfferPlan`) rather than emptying `QUEST_DEFS`.
 * Emptying the list would have been the tempting move and would have broken every one of the assertions
 * below: `QUEST_INDEX` lookups return undefined, the badge row drops the quest, banked `pendingQuestRewards`
 * are silently discarded, and a QA scenario carrying the id fails validation.
 *
 * What must hold for a legacy save:
 *   · it DESERIALIZES — no crash, and the quest is still there afterwards;
 *   · its quest still RESOLVES through `QUEST_INDEX`, so text, badges and rewards all still find their def;
 *   · it still PROGRESSES and still PAYS — an in-flight objective is not stranded at 14/18 forever;
 *   · its pinned opponents survive the round trip (an archive must not disturb `servedBoards`);
 *   · and no NEW quest is ever added to it — the archive still holds for the rest of that run.
 */
import { describe, expect, it } from 'vitest';
import { QUEST_INDEX } from '@game/content';
import { createRun, deserialize, serialize, type RunState } from './state';
import { reduce } from './reducer';

/** A run as it would have been saved before the archive: Fi, mid-run, holding a hero quest one step from its
 *  threshold, with a pinned opponent board for a wave already fought. */
function legacyQuestSave(): string {
  const def = QUEST_INDEX['hq_spare_forge']!;
  const s: RunState = {
    ...createRun(3, 'fi'),
    wave: 6,
    tier: 3,
    embers: 20,
    board: [],
    hand: [{ uid: 'h1', cardId: 'b2_packstrider', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    activeQuests: [{ questId: 'hq_spare_forge', progress: def.objective.count - 1, completed: false }],
    servedBoards: {
      5: {
        v: 1, wave: 5, heroId: 'warden', resolve: 30, tier: 3, setId: 'set2',
        minions: [{ cardId: 'b2_packstrider', attack: 2, health: 2 }],
      } as never,
    },
  };
  return serialize(s);
}

describe('a saved run carrying a quest survives the archive', () => {
  it('deserializes without throwing, and keeps the quest it was holding', () => {
    const json = legacyQuestSave();
    let s!: RunState;
    expect(() => { s = deserialize(json); }).not.toThrow();
    expect(s.heroId).toBe('fi');
    expect(s.activeQuests).toHaveLength(1);
    expect(s.activeQuests![0]!.questId).toBe('hq_spare_forge');
    expect(s.activeQuests![0]!.completed).toBe(false);
  });

  it('its quest still RESOLVES by id — the archived-content contract', () => {
    // The load-bearing one. `deserialize` heals a save by merging over a fresh `createRun`, so an unresolvable
    // quest id would not crash HERE — it would degrade silently: the badge disappears, progress stops ticking,
    // banked rewards are dropped. Asserting the lookup is what catches that.
    const s = deserialize(legacyQuestSave());
    const def = QUEST_INDEX[s.activeQuests![0]!.questId];
    expect(def, 'an archived quest must stay resolvable, exactly like an archived card').toBeDefined();
    expect(def!.heroQuest).toBe('fi');
    expect(def!.reward).toBeDefined();
  });

  it('its in-flight objective still ADVANCES and still PAYS OUT', () => {
    // Primed one step short: playing a minion is one `journey` step, which crosses the threshold and hands
    // over Spare Forge's Basic Rune. A stranded quest would sit at progress-1 forever.
    const s = deserialize(legacyQuestSave());
    const after = reduce(s, { type: 'play', uid: 'h1', toIndex: 0 });
    expect(after.activeQuests![0]!.completed, 'the legacy quest completed').toBe(true);
    expect(after.ownedRunes?.length, 'and paid its reward through the live engine').toBe(1);
  });

  it('its PINNED opponents survive the round trip untouched', () => {
    const s = deserialize(legacyQuestSave());
    expect(s.servedBoards?.[5]).toBeTruthy();
    expect(s.servedBoards![5]!.minions.map((c) => c.cardId)).toEqual(['b2_packstrider']);
  });

  it('but no NEW quest is ever offered to it — the archive holds for the rest of the run', () => {
    let s = deserialize(legacyQuestSave());
    const win = { result: 'win' as const, events: [], playerDamage: 0, initial: { player: [], enemy: [] } };
    for (let i = 0; i < 8; i++) {
      s = reduce({ ...s, phase: 'combat', combatSettled: false, lastCombat: win as never }, { type: 'resolveCombat' });
      expect(s.questOffer, `wave ${s.wave} offered a new quest to a legacy run`).toBeUndefined();
      expect(s.activeQuests!.length, 'the run never picks up a SECOND quest').toBe(1);
    }
  });

  it('re-serializes to a state that deserializes identically (the replay round trip)', () => {
    const once = deserialize(legacyQuestSave());
    const twice = deserialize(serialize(once));
    expect(twice.activeQuests).toEqual(once.activeQuests);
    expect(twice.wave).toBe(once.wave);
    expect(twice.heroId).toBe(once.heroId);
  });
});
