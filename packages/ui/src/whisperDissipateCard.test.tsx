// @vitest-environment jsdom
/**
 * WHISPER DISSIPATE on the card (owner 2026-10-14: "whispers need to coalesce/dissipate when unused at end of turn and
 * not just immediately go away"). A hand card told to dissipate wears the one-shot `.whisperdissipate` class with its
 * stagger as `--wd-delay`; every other card wears neither, so nothing else in the hand animates.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardCard } from '@game/sim';
import { Card } from './Card';
import { instView } from './instView';
import { mount } from './renderedText.mount';
import { WHISPER_DISSIPATE_MS } from './whisperDissipate';

const handCard = (cardId: string, uid: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false, grantedTier: 3 }) as BoardCard;

describe('whisper dissipate: the card', () => {
  const m = mount(<div />);
  afterAll(() => m.unmount());
  const render = (dissipate?: number): HTMLElement => {
    const view = instView(handCard('w4_tome', 'u-w'), 3, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { inHand: true });
    m.render(<Card card={view} uid="u-w" plated forceFull dissipate={dissipate} />);
    return m.container.querySelector<HTMLElement>('.card')!;
  };

  it('a dissipating Whisper wears the one-shot class with its stagger delay', () => {
    const el = render(80);
    expect(el.classList.contains('whisperdissipate')).toBe(true);
    expect(el.style.getPropertyValue('--wd-delay')).toBe('80ms');
  });

  it('a card that is not leaving wears neither', () => {
    const el = render(undefined);
    expect(el.classList.contains('whisperdissipate')).toBe(false);
    expect(el.style.getPropertyValue('--wd-delay')).toBe('');
  });

  it('the CSS animation is one-shot, compositor-only and as long as the plan says', () => {
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    const rule = /\.row\.hand \.card\.whisperdissipate \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(new RegExp(`animation: whisperdissipate ${WHISPER_DISSIPATE_MS}ms [^;]* var\\(--wd-delay, 0ms\\) both`));
    expect(rule).not.toMatch(/infinite/);
    const frames = /@keyframes whisperdissipate \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    // Only opacity and the individual transform properties move (no paint properties in the animation).
    const props = [...frames.matchAll(/([a-z-]+):/g)].map((x) => x[1]);
    expect(new Set(props)).toEqual(new Set(['opacity', 'translate', 'scale']));
  });
});
