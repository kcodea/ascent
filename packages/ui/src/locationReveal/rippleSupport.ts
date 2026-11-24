import { PHONE_GPU } from '../phoneDiag';

/** May this machine draw the living ground and the ripple? (Phones, reduced motion and no WebGL 2: no.) */
export const canRun = (): boolean => typeof window !== 'undefined' && !PHONE_GPU && typeof createImageBitmap === 'function'
  && typeof WebGL2RenderingContext !== 'undefined'
  && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
