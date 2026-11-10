/**
 * THE CONCEDE NOTE SAYS WHAT THIS MODE LOSES (R-CONCEDE-COPY-01, Duos audit 2026-11-09). One line served every Versus
 * area: "Your opponent wins this match. You go back to the room." That is true of a 1v1 only. A group seat goes out and
 * the table plays on; a Versus Duos concede takes the whole team out; a Ranked Duos concede is for good while the
 * teammate plays on. Also: the Pass glossary line matches the pass rules (R-DUOS-PASS-GLOSSARY-01).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { duosPassBlocked } from '@game/sim';
import { concedeAreaOf, leaveText, settingsLeaveText } from './gameMenuParts';
import { KEYWORD_GLOSSARY } from './keywordGlossary';

const match = (mode?: string) => ({ group: { raw: { options: mode ? { mode } : null } } });

describe('R-CONCEDE-COPY-01: the concede note per Versus area', () => {
  it('the area comes off the match on screen', () => {
    expect(concedeAreaOf(null)).toBe('duel');
    expect(concedeAreaOf({})).toBe('duel'); // a 1v1 match carries no group table
    expect(concedeAreaOf(match())).toBe('group');
    expect(concedeAreaOf(match('group'))).toBe('group');
    expect(concedeAreaOf(match('duos'))).toBe('duos');
    expect(concedeAreaOf(match('ranked_duos'))).toBe('rankedDuos');
  });

  it('each area reads its own consequence; only a 1v1 names "your opponent"', () => {
    expect(leaveText('concede', false, false).note).toBe('Your opponent wins this match. You go back to the room.');
    expect(leaveText('concede', false, false, false, 'duel').note).toBe('Your opponent wins this match. You go back to the room.');
    expect(leaveText('concede', false, false, false, 'group').note).toBe('You are out of this match. You can watch the rest.');
    expect(leaveText('concede', false, false, false, 'duos').note).toBe('Your whole team is out of this match. Your teammate goes out with you.');
    expect(leaveText('concede', false, false, false, 'rankedDuos').note).toBe('You leave this match for good. Your teammate plays on without you.');
    for (const area of ['group', 'duos', 'rankedDuos'] as const) {
      const t = leaveText('concede', false, false, false, area);
      expect(t.label).toBe('Concede');
      expect(t.note).not.toMatch(/opponent wins/);
      expect(t.note).not.toMatch(/\u2014|--/); // player text: no em dash
      expect(settingsLeaveText('concede', false, false, false, area).note).toBe(t.note); // Settings says the same
    }
  });

  it('a finished match still reads "Leave match" in every area', () => {
    for (const area of ['duel', 'group', 'duos', 'rankedDuos'] as const) {
      expect(leaveText('concede', false, false, true, area)).toEqual({ label: 'Leave match', confirm: 'Tap again to leave', note: 'The match is over. Back to the room.' });
    }
  });

  it('both leave buttons pass the area of the match on screen', () => {
    expect(readFileSync(join(__dirname, 'gameMenuParts.tsx'), 'utf8')).toContain('const area = useVersus((s) => concedeAreaOf(s.match));');
    expect(readFileSync(join(__dirname, 'partyHome/pages/PhSettings.tsx'), 'utf8')).toContain('const area = useVersus((s) => concedeAreaOf(s.match));');
  });
});

describe('R-DUOS-PASS-GLOSSARY-01: the Pass line matches the pass rules', () => {
  const def = KEYWORD_GLOSSARY.find((d) => d.id === 'pass')!.def;
  it('never says a Gilded (Golden) minion cannot be passed; it says pass spells cannot target one', () => {
    expect(def).not.toMatch(/Golden/);
    expect(def).not.toMatch(/can't be passed/);
    expect(def).toBe("Give a card from your hand to your teammate. It goes to their hand. Spells that pass can't target a Gilded minion.");
  });
  it('the rule it describes: a golden minion in hand passes by hand', () => {
    const golden = { uid: 'g1', cardId: 'x', golden: true };
    const s = { duos: {}, phase: 'recruit', hand: [golden], board: [], embers: 10, wave: 3 } as never;
    expect(duosPassBlocked(s, 'g1')).toBeNull();
  });
});
