/** Capture slots: a still poster first, a looping clip swapped in only when one exists, motion is allowed and it plays. */

export const CAPTURE_SLOTS: readonly string[] = [
  'gold-fuse',
  'runeforge',
  'ancient-select',
  'career-chart',
  'chest-opening',
];

/** Slots that have a recorded clip in public/captures (webm + mp4). Recorded by scripts/capture.mjs. */
export const CLIPS: ReadonlySet<string> = new Set<string>([
  'discover-timer',
  'gold-fuse',
  'rearrange',
  'save-continue',
  'runeforge',
  'ancient-select',
  'career-chart',
  'chest-opening',
]);

let clips: ReadonlySet<string> = CLIPS;

/** Test hook: swap the clip list. Call with no argument to restore the real one. */
export function __setClipsForTest(ids?: readonly string[]): void {
  clips = ids ? new Set(ids) : CLIPS;
}

export interface CaptureOptions {
  reducedMotion: boolean;
  observe: (el: Element, onVisible: () => void) => void;
}

function addVideo(fig: Element, slot: string, poster: HTMLImageElement | null): void {
  const doc = fig.ownerDocument;
  const video = doc.createElement('video');
  video.className = 'capture__video';
  video.muted = true;
  video.setAttribute('muted', '');
  video.loop = true;
  video.setAttribute('loop', '');
  video.setAttribute('playsinline', '');
  video.autoplay = true;
  video.setAttribute('autoplay', '');
  video.setAttribute('preload', 'none');
  video.setAttribute('poster', `/captures/${slot}.jpg`);
  // The poster is hidden while the clip plays, so the clip carries the poster's description.
  if (poster?.alt) video.setAttribute('aria-label', poster.alt);

  const drop = (): void => {
    video.remove();
    if (poster) poster.hidden = false;
  };
  const sources = [
    ['webm', 'video/webm'],
    ['mp4', 'video/mp4'],
  ] as const;
  for (const [ext, type] of sources) {
    const source = doc.createElement('source');
    source.src = `/captures/${slot}.${ext}`;
    source.type = type;
    // A failed source reports on itself, not on the video; the last one failing means nothing can play.
    if (ext === 'mp4') source.addEventListener('error', drop);
    video.append(source);
  }
  video.addEventListener('error', drop);
  video.addEventListener('playing', () => {
    video.setAttribute('data-playing', '');
    if (poster) poster.hidden = true;
  });
  // Straight after the poster, so in a figure with a caption the clip sits where the still was, above the words.
  if (poster) poster.after(video);
  else fig.prepend(video);
}

export function initCaptures(doc: Document, opts: CaptureOptions): void {
  if (opts.reducedMotion) return;
  for (const fig of doc.querySelectorAll('figure[data-capture]')) {
    const slot = fig.getAttribute('data-capture') ?? '';
    if (!clips.has(slot)) continue;
    const poster = fig.querySelector<HTMLImageElement>('img[data-poster]');
    opts.observe(fig, () => {
      if (!fig.querySelector('video')) addVideo(fig, slot, poster);
    });
  }
}
