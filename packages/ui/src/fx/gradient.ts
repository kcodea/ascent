export type GradientStop = { at: number; color: number };
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const sorted = (s: GradientStop[]): GradientStop[] => [...s].sort((a, b) => a.at - b.at);

export const addStop = (stops: readonly GradientStop[], at: number, color: number): GradientStop[] =>
  sorted([...stops, { at: clamp01(at), color: color & 0xffffff }]);

export const removeStop = (stops: readonly GradientStop[], i: number): GradientStop[] =>
  stops.length <= 2 ? [...stops] : sorted(stops.filter((_, k) => k !== i));

export const moveStop = (stops: readonly GradientStop[], i: number, at: number): GradientStop[] =>
  sorted(stops.map((s, k) => (k === i ? { ...s, at: clamp01(at) } : s)));
