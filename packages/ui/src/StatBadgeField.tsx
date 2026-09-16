import { useEffect, useRef, useState } from 'react';

/**
 * DEV-only editable stat badges — the game's own Attack / Health circles, made typeable.
 *
 * The markup is EXACTLY the card's (`Card.tsx`): `.badge.atk` / `.badge.hp` seating a `.plate` (the shape)
 * and a `.value` (the digit) as SIBLINGS, so the red/green plates, the border and the digit face are the
 * real ones, not look-alikes. The only difference is that `.value` is an `<input>` styled invisibly — so the
 * number you read IS the field you type into. A `.sb-stat` wrapper (styles.css) un-absolutes the badge and
 * shrinks it to panel scale; nothing about the badge's own rules changes.
 *
 * Editing: click to type; ↑/↓ and the mouse wheel step by 1 (Shift = 5); ↵ / blur commit; Esc reverts. The
 * draft is a local STRING so clearing the field to retype never fights you (see the note in `UnitEditor`'s
 * old NumField); only a real number is reported up, and the floor (`min`) is applied on commit so 0 health
 * settles to 1 and a stray minus sign settles to the floor rather than NaN.
 *
 * Used by the Scene Builder's dummies row and by the sandbox `UnitEditor` (owner ask 2026-09-16 — the
 * Windows number spinners looked nothing like the game).
 */
export function StatBadgeField({ stat, value, min, max, onCommit, title }: {
  stat: 'atk' | 'hp';
  value: number;
  min: number;
  max?: number;
  onCommit: (n: number) => void;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const clamp = (n: number): number => Math.max(min, max === undefined ? n : Math.min(max, n));
  const commit = (text: string): void => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) onCommit(clamp(Math.round(n)));
    setDraft(null); // invalid / empty → the badge shows the committed value again
  };
  const step = (delta: number): void => {
    const cur = draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft)) ? Number(draft) : value;
    onCommit(clamp(Math.round(cur) + delta));
    setDraft(null);
  };
  // React registers `wheel` as a PASSIVE root listener, so `e.preventDefault()` in `onWheel` is a no-op and the
  // panel would scroll while the number steps. A native non-passive listener on the input is the fix.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      stepRef.current((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 5 : 1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <span className={`badge ${stat}`} title={title} data-testid={`sb-badge-${stat}`}>
      <span className="plate" aria-hidden="true" />
      <input
        ref={inputRef}
        className="value"
        inputMode="numeric"
        aria-label={stat === 'atk' ? 'Attack' : 'Health'}
        value={draft ?? String(value)}
        size={Math.max(1, String(draft ?? value).length)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); step(e.shiftKey ? 5 : 1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); step(e.shiftKey ? -5 : -1); }
        }}
      />
    </span>
  );
}

/**
 * The count stepper (`×5`) in the same visual language as the badges: a small brass pill with ‹ › arrows;
 * the number itself is typeable, and ↑/↓ / wheel step it exactly like the badges do (Shift = 5).
 */
export function CountStepper({ value, min, max, onCommit, title }: {
  value: number; min: number; max: number; onCommit: (n: number) => void; title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const clamp = (n: number): number => Math.max(min, Math.min(max, n));
  const commit = (text: string): void => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) onCommit(clamp(Math.round(n)));
    setDraft(null);
  };
  const step = (delta: number): void => {
    const cur = draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft)) ? Number(draft) : value;
    onCommit(clamp(Math.round(cur) + delta));
    setDraft(null);
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      stepRef.current((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 5 : 1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  return (
    <span className="sb-countstep" title={title} data-testid="sb-count">
      <button type="button" className="sb-countstep-btn" onClick={() => step(-1)} disabled={value <= min} aria-label="Fewer" tabIndex={-1}>‹</button>
      <span className="sb-countstep-x" aria-hidden>×</span>
      <input
        ref={inputRef}
        className="sb-countstep-n"
        inputMode="numeric"
        aria-label="How many"
        value={draft ?? String(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); step(e.shiftKey ? 5 : 1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); step(e.shiftKey ? -5 : -1); }
        }}
      />
      <button type="button" className="sb-countstep-btn" onClick={() => step(1)} disabled={value >= max} aria-label="More" tabIndex={-1}>›</button>
    </span>
  );
}
