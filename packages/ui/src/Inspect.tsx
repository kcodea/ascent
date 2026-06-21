import { useEffect } from 'react';
import { Card } from './Card';
import { useGame } from './store';

/**
 * Right-click "inspect": the card floats to the centre of the screen, enlarged, over
 * a dimmed backdrop so the player can read it closely. Click the backdrop (or press
 * Escape) to dismiss.
 */
export function Inspect() {
  const inspect = useGame((s) => s.inspect);
  const clearInspect = useGame((s) => s.clearInspect);

  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') clearInspect();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspect, clearInspect]);

  if (!inspect) return null;
  return (
    <div
      className="inspect-ov"
      onClick={clearInspect}
      onContextMenu={(e) => {
        e.preventDefault();
        clearInspect();
      }}
      role="dialog"
      aria-label={`${inspect.name} — close to dismiss`}
    >
      <div className="inspect-card" onClick={(e) => e.stopPropagation()}>
        {inspect.buffs && inspect.buffs.length > 0 && (
          <div className="inspect-buffs">
            <div className="ib-title">Buffs</div>
            {inspect.buffs.map((b, i) => (
              <div className="ib-row" key={`${b.source}-${i}`}>
                <span className="ib-src">{b.source} <em>×{b.count}</em></span>
                <span className="ib-amt">+{b.attack}/+{b.health}</span>
              </div>
            ))}
          </div>
        )}
        <Card card={inspect} forceFull />
      </div>
    </div>
  );
}
