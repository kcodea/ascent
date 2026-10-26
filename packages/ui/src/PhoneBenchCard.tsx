import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { runPhoneBench, type BenchResult } from './phoneBench';
import { stageHost } from './stage';
import './perfLog.css';

/**
 * The on-device auto-bench's card (R-PHONE-BENCH-01): the step it is on while it drives the game, then the summary
 * with Copy. Loaded only with `?phonebench=1` (Game.tsx, lazy). Static: nothing animates.
 */
export default function PhoneBenchCard(): React.ReactElement | null {
  const [step, setStep] = useState('starting');
  const [res, setRes] = useState<BenchResult | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { void runPhoneBench(setStep).then(setRes); }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="perflog perfbench" role="status">
      <div className="perflog-head">
        <span>{res ? `Phone bench done, ${res.secs} s` : `Phone bench running: ${step}. Do not touch.`}</span>
        {res && (
          <button type="button" className="perflog-btn" onClick={() => {
            void navigator.clipboard?.writeText(res.summary).then(() => setCopied(true), () => setCopied(false));
          }}>{copied ? 'Copied' : 'Copy'}</button>
        )}
      </div>
      {res && <pre className="perfbench-sum">{res.summary}</pre>}
    </div>,
    stageHost(),
  );
}
