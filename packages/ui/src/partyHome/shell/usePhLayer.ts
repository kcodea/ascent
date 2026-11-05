import { useEffect, useRef } from 'react';
import { phLayer } from './phHistory';

/** While `open`, this is the top layer on the one Back path (phHistory.ts): Esc and every Back close it first. Off the shell it does nothing. */
export function usePhLayer(open: boolean, close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => (open ? phLayer(() => ref.current()) : undefined), [open]);
}
