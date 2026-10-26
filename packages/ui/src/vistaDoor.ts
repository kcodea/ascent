/**
 * THE RETURN TRIP'S DOORWAY, AS A SHAPE (owner report 2026-10-25: "we are still getting reports of the images glitching
 * and not loading straight away for the return to shop animation"; R-PRESENT-36).
 *
 * The door's cut-out was a 2560 x 1440 picture used as a CSS mask (`vista-doormask.png`, 14.1 MB decoded). Chromium's
 * compositor decodes a picture that big only when it first needs it, and while a mask's picture is not decoded it
 * hides EVERYTHING the mask applies to: the sky, hills, title and shop vanished for a frame as the cut-out switched on
 * (measured: 79% of the screen on the first trip of a session, none on the next). Decoding it in JavaScript does not
 * help: that fills a different cache from the one the compositor draws with.
 *
 * So the hole is now vector geometry, an SVG `clipPath` the browser draws with no picture to decode. This is the
 * outline of the owner's own door shape (traced from his 193 x 255 px drawing at (1124, 947) on the 2560 x 1440 art,
 * simplified to 44 points within 0.75 px), in the 0..1 units of the art (`clipPathUnits="objectBoundingBox"`).
 * `VISTA_DOOR_CLIP` is the whole picture minus the doorway (even-odd), what `.wipevista-masked` keeps.
 */
export const VISTA_DOOR_OUTLINE = 'M0.47793,0.65799L0.48652,0.65868L0.48965,0.66007L0.49629,0.66563L0.50137,0.67257L0.5041,0.67812L0.50879,0.69201L0.51113,0.70313L0.5123,0.71146L0.51309,0.72326L0.51348,0.72396L0.51348,0.7316L0.51387,0.73229L0.51387,0.7559L0.51348,0.7566L0.51348,0.76701L0.51309,0.76771L0.51309,0.80521L0.50723,0.80521L0.50527,0.80868L0.50215,0.81771L0.49512,0.83437L0.43965,0.83299L0.43965,0.8059L0.43926,0.80521L0.43926,0.76563L0.43965,0.76493L0.43965,0.75313L0.44004,0.75243L0.44004,0.74549L0.44043,0.74479L0.44043,0.73993L0.44082,0.73924L0.44082,0.73507L0.44121,0.73438L0.44199,0.72396L0.44512,0.7059L0.4502,0.68854L0.45293,0.68229L0.45723,0.67465L0.46152,0.6691L0.46738,0.66354L0.47441,0.65938L0.47754,0.65868Z';
export const VISTA_DOOR_CLIP = `M0,0H1V1H0Z ${VISTA_DOOR_OUTLINE}`;
/** The id the stylesheet's `clip-path: url(#wipevista-door)` names (styles.css, the cut-out rule). */
export const VISTA_DOOR_CLIP_ID = 'wipevista-door';
