import { useState } from 'react';
import { createPortal } from 'react-dom';
import { clearCrashes, crashedSessions, crashReadoutWanted, describeCrumb, lastStep } from './crashLog';
import { stageHost } from './stage';
import './crashLog.css';

/**
 * The crash log's readout (R-TOUCH-PLAY-MEMORY-01): "Last session crashed after: <step>", with the memory it saw
 * there and the steps before it. Shows only with `?crashlog=1` (remembered until `?crashlog=0`; never by itself after a
 * crash since R-PHONE-RESUME-01, crashLog.ts says why). Close forgets the recorded crashes. Portalled into the
 * stage host like every layer (stageTripwire), counter-scaled in crashLog.css.
 */
export function CrashLogReadout(): React.ReactElement | null {
  const [wanted] = useState(() => crashReadoutWanted());
  const [open, setOpen] = useState(true);
  if (!wanted || !open) return null;
  const crashes = crashedSessions();
  const last = crashes[0];
  const step = last ? lastStep(last) : undefined;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="crashlog" role="status">
      <div className="crashlog-head">
        <span>{step ? `Last session crashed after: ${step.s}` : 'No crash recorded.'}</span>
        <button type="button" className="crashlog-x" aria-label="Close the crash log" onClick={() => { clearCrashes(); setOpen(false); }}>✕</button>
      </div>
      {step && <div className="crashlog-line">{describeCrumb(step)}</div>}
      {last && (
        <ol className="crashlog-steps">
          {last.crumbs.slice(-10).map((c, i) => <li key={i}><b>{c.s}</b> {describeCrumb(c)}</li>)}
        </ol>
      )}
      {crashes.length > 1 && <div className="crashlog-line">{crashes.length} crashes on record. The ones before: {crashes.slice(1).map((s) => lastStep(s)?.s ?? 'boot').join('; ')}.</div>}
    </div>,
    stageHost(),
  );
}
