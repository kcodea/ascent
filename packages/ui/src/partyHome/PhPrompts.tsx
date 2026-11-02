/**
 * The party home's two prompts in the shell's language (DEV prototype; Title.tsx renders these instead of the old
 * windows while the party home is up, so START never drops the player into a different style):
 *  - the first-time nudge to the tutorial (owner 2026-08-17), the same two choices;
 *  - the ranked confirmation (R-RANK-06), the owner's words, "Yes" on the press (pointer down) like the old one.
 */
import { PhButton, PhDialog } from './kit';

export function PhTutorialPrompt({ onTutorial, onSkip, onClose }: { onTutorial: () => void; onSkip: () => void; onClose: () => void }) {
  return (
    <PhDialog label="New here?" eyebrow="First time?" title="Try the Tutorial" onClose={onClose}
      actions={<>
        <PhButton variant="primary" size="l" onClick={onTutorial}>Start the Tutorial</PhButton>
        <PhButton variant="ghost" size="l" onClick={onSkip}>Skip and just play</PhButton>
      </>}>
      <p>A quick coached game teaches you everything: shop, build, position and win. About five minutes.</p>
    </PhDialog>
  );
}

export function PhRankedPrompt({ title, text, warning, yes, no, closing, onYes, onNo }: {
  title: string; text: string; warning: string | null; yes: string; no: string; closing: boolean; onYes: () => void; onNo: () => void;
}) {
  return (
    <PhDialog label="Ranked lobby" eyebrow="Ranked" title={title} onClose={onNo} closing={closing}
      actions={<>
        <PhButton variant="primary" size="l" disabled={closing} onPointerDown={(e) => { if (e.button === 0) onYes(); }} onClick={onYes}>{yes}</PhButton>
        <PhButton size="l" onClick={onNo}>{no}</PhButton>
      </>}>
      <p>{text}</p>
      {warning && <p className="phk-warn">{warning}</p>}
    </PhDialog>
  );
}
