/**
 * The PURE planning behind "import N individual frames as one sprite sheet" (`imageLibrary.ts`'s
 * `importFramesFromFiles`): filename ordering, the sheet's name, the grid, and the cell size that keeps the
 * packed sheet under the import cap. No DOM, no Pixi — unit-tested headless.
 */

/** Natural filename order: numeric runs compare by value, so `frame_9` sorts before `frame_10`. */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const ta = a.toLowerCase().match(re) ?? [];
  const tb = b.toLowerCase().match(re) ?? [];
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const x = ta[i];
    const y = tb[i];
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return ta.length - tb.length;
}

/** The name a packed sheet takes: the longest common prefix of the frames' stems, with any trailing
 *  separators / digits trimmed (`explosion_01`…`explosion_12` → `explosion`). Falls back to the first stem,
 *  then to `sheet`. */
export function commonStem(names: string[]): string {
  const stems = names.map((n) => n.replace(/\.[^.]+$/, ''));
  if (stems.length === 0) return 'sheet';
  let prefix = stems[0];
  for (const s of stems.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
  }
  const trimmed = prefix.replace(/[\s_\-.]*\d*[\s_\-.]*$/, '');
  return trimmed !== '' ? trimmed : (stems[0] !== '' ? stems[0] : 'sheet');
}

/** The grid for `count` frames: `framesPerRow` columns when given (> 0), else near-square. */
export function planGrid(count: number, framesPerRow = 0): { cols: number; rows: number } {
  const n = Math.max(1, Math.floor(count));
  const cols = framesPerRow > 0 ? Math.min(n, Math.floor(framesPerRow)) : Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/** One cell's size: the largest frame, shrunk (never grown) so the whole `cols × rows` sheet fits within
 *  `cap` on both sides. Every frame is later fitted into this cell aspect-preserved. */
export function planCell(maxW: number, maxH: number, cols: number, rows: number, cap: number): { w: number; h: number } {
  const w0 = Math.max(1, maxW);
  const h0 = Math.max(1, maxH);
  const scale = Math.min(1, cap / (cols * w0), cap / (rows * h0));
  return { w: Math.max(1, Math.floor(w0 * scale)), h: Math.max(1, Math.floor(h0 * scale)) };
}
