/**
 * THE FILTER REGISTRY — every `pixi-filters` (+ core) post-process the FILTER LAB exposes, one entry each.
 * Consumed by `filterStack.ts` (`filterLabSpecs` to build the params, `FilterStack` to run them). Adding a
 * filter is one entry here; nothing else changes.
 *
 * DELIBERATELY OMITTED — five filters can't be driven by scalar knobs alone (they need a Texture, a colour
 * array, or a convolution matrix the workbench has no input for): color-map (LUT texture), color-gradient
 * (stops array), multi-color-replace (colour-pair array), simple-lightmap (light texture), convolution
 * (9-element matrix). They'd need real asset plumbing to be useful, so they're left out of the lab for now.
 */
import { AdjustmentFilter } from 'pixi-filters/adjustment';
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom';
import { AsciiFilter } from 'pixi-filters/ascii';
import { BevelFilter } from 'pixi-filters/bevel';
import { BloomFilter } from 'pixi-filters/bloom';
import { BulgePinchFilter } from 'pixi-filters/bulge-pinch';
import { ColorOverlayFilter } from 'pixi-filters/color-overlay';
import { ColorReplaceFilter } from 'pixi-filters/color-replace';
import { CRTFilter } from 'pixi-filters/crt';
import { CrossHatchFilter } from 'pixi-filters/cross-hatch';
import { DotFilter } from 'pixi-filters/dot';
import { DropShadowFilter } from 'pixi-filters/drop-shadow';
import { EmbossFilter } from 'pixi-filters/emboss';
import { GlitchFilter } from 'pixi-filters/glitch';
import { GlowFilter } from 'pixi-filters/glow';
import { GodrayFilter } from 'pixi-filters/godray';
import { GrayscaleFilter } from 'pixi-filters/grayscale';
import { HslAdjustmentFilter } from 'pixi-filters/hsl-adjustment';
import { KawaseBlurFilter } from 'pixi-filters/kawase-blur';
import { MotionBlurFilter } from 'pixi-filters/motion-blur';
import { OldFilmFilter } from 'pixi-filters/old-film';
import { OutlineFilter } from 'pixi-filters/outline';
import { PixelateFilter } from 'pixi-filters/pixelate';
import { RadialBlurFilter } from 'pixi-filters/radial-blur';
import { ReflectionFilter } from 'pixi-filters/reflection';
import { RGBSplitFilter } from 'pixi-filters/rgb-split';
import { ShockwaveFilter } from 'pixi-filters/shockwave';
import { SimplexNoiseFilter } from 'pixi-filters/simplex-noise';
import { TiltShiftFilter } from 'pixi-filters/tilt-shift';
import { TwistFilter } from 'pixi-filters/twist';
import { ZoomBlurFilter } from 'pixi-filters/zoom-blur';
import type { FxFilterSpec } from './filterStack';

/** Newest/aura-first ordering is cosmetic (registry order = composite order + group order in the panel). */
export const FILTERS: readonly FxFilterSpec[] = [
  // — Bloom & glow —
  { id: 'advancedBloom', label: 'Bloom (Advanced)', make: () => new AdvancedBloomFilter(), amountProp: 'bloomScale', amount: [0, 3, 1.3],
    knobs: [{ name: 'threshold', label: 'Threshold', prop: 'threshold', kind: 'slider', range: [0, 1, 0.5] }, { name: 'brightness', label: 'Brightness', prop: 'brightness', kind: 'slider', range: [0, 3, 1] }, { name: 'blur', label: 'Blur', prop: 'blur', kind: 'slider', range: [0, 20, 8] }] },
  { id: 'bloom', label: 'Bloom (Simple)', make: () => new BloomFilter(), amountProp: 'strength', amount: [0, 20, 6], amountStep: 0.5, knobs: [] },
  { id: 'glow', label: 'Glow', make: () => new GlowFilter(), amountProp: 'outerStrength', amount: [0, 20, 4], amountStep: 0.1,
    knobs: [{ name: 'inner', label: 'Inner strength', prop: 'innerStrength', kind: 'slider', range: [0, 20, 0], step: 0.1 }, { name: 'alpha', label: 'Alpha', prop: 'alpha', kind: 'slider', range: [0, 1, 1] }, { name: 'knockout', label: 'Knockout', prop: 'knockout', kind: 'toggle' }, { name: 'color', label: 'Colour', prop: 'color', kind: 'color', defaultColor: 0xffffff }] },
  { id: 'godray', label: 'Godrays', make: () => new GodrayFilter(), amountProp: 'gain', amount: [0, 1, 0.5], animateTime: true,
    knobs: [{ name: 'lacunarity', label: 'Lacunarity', prop: 'lacunarity', kind: 'slider', range: [0, 10, 2.5] }, { name: 'angle', label: 'Angle', prop: 'angle', kind: 'slider', range: [-90, 90, 30], step: 1 }, { name: 'alpha', label: 'Alpha', prop: 'alpha', kind: 'slider', range: [0, 1, 1] }] },

  // — Distortion —
  { id: 'zoomBlur', label: 'Zoom Blur', make: () => new ZoomBlurFilter(), amountProp: 'strength', amount: [0, 1, 0.3],
    knobs: [{ name: 'inner', label: 'Inner radius', prop: 'innerRadius', kind: 'slider', range: [0, 500, 0], step: 1 }, { name: 'maxK', label: 'Max kernel', prop: 'maxKernelSize', kind: 'slider', range: [1, 64, 32], step: 1 }] },
  { id: 'radialBlur', label: 'Radial Blur', make: () => new RadialBlurFilter(), amountProp: 'angle', amount: [-180, 180, 30], amountStep: 1,
    knobs: [{ name: 'kernel', label: 'Kernel', prop: 'kernelSize', kind: 'slider', range: [3, 25, 5], step: 2 }, { name: 'radius', label: 'Radius', prop: 'radius', kind: 'slider', range: [-1, 1000, -1], step: 1 }] },
  { id: 'motionBlur', label: 'Motion Blur', make: () => new MotionBlurFilter(), amountProp: 'velocityX', amount: [-100, 100, 30], amountStep: 1,
    knobs: [{ name: 'velY', label: 'Velocity Y', prop: 'velocityY', kind: 'slider', range: [-100, 100, 0], step: 1 }, { name: 'kernel', label: 'Kernel', prop: 'kernelSize', kind: 'slider', range: [5, 25, 5], step: 2 }] },
  { id: 'shockwave', label: 'Shockwave', make: () => new ShockwaveFilter(), amountProp: 'brightness', amount: [0, 5, 1.2], animateTime: true,
    knobs: [{ name: 'amp', label: 'Amplitude', prop: 'amplitude', kind: 'slider', range: [0, 100, 30], step: 1 }, { name: 'wave', label: 'Wavelength', prop: 'wavelength', kind: 'slider', range: [0, 500, 160], step: 1 }] },
  { id: 'twist', label: 'Twist', make: () => new TwistFilter(), amountProp: 'angle', amount: [-10, 10, 4], amountStep: 0.1,
    knobs: [{ name: 'radius', label: 'Radius', prop: 'radius', kind: 'slider', range: [0, 500, 200], step: 1 }, { name: 'padding', label: 'Padding', prop: 'padding', kind: 'slider', range: [0, 100, 20], step: 1 }] },
  { id: 'bulgePinch', label: 'Bulge / Pinch', make: () => new BulgePinchFilter(), amountProp: 'strength', amount: [-1, 1, 1],
    knobs: [{ name: 'radius', label: 'Radius', prop: 'radius', kind: 'slider', range: [0, 500, 100], step: 1 }] },
  { id: 'simplexNoise', label: 'Simplex Noise', make: () => new SimplexNoiseFilter(), amountProp: 'strength', amount: [0, 2, 0.5],
    knobs: [{ name: 'scale', label: 'Noise scale', prop: 'noiseScale', kind: 'slider', range: [0, 50, 10], step: 0.5 }, { name: 'step', label: 'Step', prop: 'step', kind: 'slider', range: [-1, 1, -1] }] },
  { id: 'tiltShift', label: 'Tilt Shift', make: () => new TiltShiftFilter(), amountProp: 'blur', amount: [0, 200, 100], amountStep: 1,
    knobs: [{ name: 'grad', label: 'Gradient blur', prop: 'gradientBlur', kind: 'slider', range: [0, 1000, 600], step: 1 }] },
  { id: 'kawaseBlur', label: 'Kawase Blur', make: () => new KawaseBlurFilter(), amountProp: 'strength', amount: [0, 20, 4], amountStep: 0.1,
    knobs: [{ name: 'quality', label: 'Quality', prop: 'quality', kind: 'slider', range: [1, 10, 3], step: 1 }] },
  { id: 'reflection', label: 'Reflection', make: () => new ReflectionFilter(), amountProp: 'amplitudeEnd', amount: [0, 50, 20], amountStep: 0.5, animateTime: true,
    knobs: [{ name: 'boundary', label: 'Boundary', prop: 'boundary', kind: 'slider', range: [0, 1, 0.5] }, { name: 'mirror', label: 'Mirror', prop: 'mirror', kind: 'toggle', default: true }] },

  // — Colour —
  { id: 'hslAdjustment', label: 'HSL', make: () => new HslAdjustmentFilter(), amountProp: 'saturation', amount: [-1, 1, 0.4],
    knobs: [{ name: 'hue', label: 'Hue', prop: 'hue', kind: 'slider', range: [-180, 180, 0], step: 1 }, { name: 'light', label: 'Lightness', prop: 'lightness', kind: 'slider', range: [-1, 1, 0] }] },
  { id: 'adjustment', label: 'Adjustment', make: () => new AdjustmentFilter(), amountProp: 'brightness', amount: [0, 3, 1.3],
    knobs: [{ name: 'contrast', label: 'Contrast', prop: 'contrast', kind: 'slider', range: [0, 3, 1] }, { name: 'saturation', label: 'Saturation', prop: 'saturation', kind: 'slider', range: [0, 3, 1] }, { name: 'gamma', label: 'Gamma', prop: 'gamma', kind: 'slider', range: [0, 3, 1] }] },
  { id: 'colorOverlay', label: 'Colour Overlay', make: () => new ColorOverlayFilter(), amountProp: 'alpha', amount: [0, 1, 0.5],
    knobs: [{ name: 'color', label: 'Colour', prop: 'color', kind: 'color', defaultColor: 0xff0000 }] },
  { id: 'colorReplace', label: 'Colour Replace', make: () => new ColorReplaceFilter(), amountProp: 'tolerance', amount: [0, 1, 0.4], knobs: [] },

  // — Stylize —
  { id: 'outline', label: 'Outline', make: () => new OutlineFilter(), amountProp: 'thickness', amount: [0, 10, 2], amountStep: 0.1,
    knobs: [{ name: 'alpha', label: 'Alpha', prop: 'alpha', kind: 'slider', range: [0, 1, 1] }, { name: 'knockout', label: 'Knockout', prop: 'knockout', kind: 'toggle' }, { name: 'color', label: 'Colour', prop: 'color', kind: 'color', defaultColor: 0x000000 }] },
  { id: 'rgbSplit', label: 'RGB Split', make: () => new RGBSplitFilter(), amountProp: 'redX', amount: [-50, 50, -10], amountStep: 1,
    knobs: [{ name: 'greenY', label: 'Green Y', prop: 'greenY', kind: 'slider', range: [-50, 50, 10], step: 1 }, { name: 'blueX', label: 'Blue X', prop: 'blueX', kind: 'slider', range: [-50, 50, 0], step: 1 }] },
  { id: 'glitch', label: 'Glitch', make: () => new GlitchFilter(), amountProp: 'offset', amount: [0, 500, 100], amountStep: 1,
    knobs: [{ name: 'slices', label: 'Slices', prop: 'slices', kind: 'slider', range: [1, 50, 5], step: 1 }, { name: 'dir', label: 'Direction', prop: 'direction', kind: 'slider', range: [0, 360, 0], step: 1 }] },
  { id: 'dropShadow', label: 'Drop Shadow', make: () => new DropShadowFilter(), amountProp: 'blur', amount: [0, 20, 4], amountStep: 0.5,
    knobs: [{ name: 'alpha', label: 'Alpha', prop: 'alpha', kind: 'slider', range: [0, 1, 1] }, { name: 'offX', label: 'Offset X', prop: 'offsetX', kind: 'slider', range: [-50, 50, 4], step: 1 }, { name: 'offY', label: 'Offset Y', prop: 'offsetY', kind: 'slider', range: [-50, 50, 4], step: 1 }, { name: 'color', label: 'Colour', prop: 'color', kind: 'color', defaultColor: 0x000000 }] },
  { id: 'bevel', label: 'Bevel', make: () => new BevelFilter(), amountProp: 'thickness', amount: [0, 10, 2], amountStep: 0.1,
    knobs: [{ name: 'rot', label: 'Rotation', prop: 'rotation', kind: 'slider', range: [0, 360, 45], step: 1 }, { name: 'lightA', label: 'Light alpha', prop: 'lightAlpha', kind: 'slider', range: [0, 1, 0.7] }, { name: 'shadowA', label: 'Shadow alpha', prop: 'shadowAlpha', kind: 'slider', range: [0, 1, 0.7] }, { name: 'lightColor', label: 'Light colour', prop: 'lightColor', kind: 'color', defaultColor: 0xffffff }, { name: 'shadowColor', label: 'Shadow colour', prop: 'shadowColor', kind: 'color', defaultColor: 0x000000 }] },
  { id: 'dot', label: 'Dot (Halftone)', make: () => new DotFilter(), amountProp: 'scale', amount: [0, 5, 1],
    knobs: [{ name: 'angle', label: 'Angle', prop: 'angle', kind: 'slider', range: [0, 10, 5] }, { name: 'gray', label: 'Grayscale', prop: 'grayscale', kind: 'toggle', default: true }] },
  { id: 'pixelate', label: 'Pixelate', make: () => new PixelateFilter(10), amountProp: 'size', amount: [1, 50, 10], amountStep: 1, knobs: [] },
  { id: 'ascii', label: 'ASCII', make: () => new AsciiFilter(), amountProp: 'size', amount: [1, 32, 8], amountStep: 1,
    knobs: [{ name: 'replace', label: 'Replace colour', prop: 'replaceColor', kind: 'toggle' }] },
  { id: 'crt', label: 'CRT', make: () => new CRTFilter(), amountProp: 'curvature', amount: [0, 10, 1], animateTime: true,
    knobs: [{ name: 'lineW', label: 'Line width', prop: 'lineWidth', kind: 'slider', range: [0, 5, 1] }, { name: 'lineC', label: 'Line contrast', prop: 'lineContrast', kind: 'slider', range: [0, 1, 0.25] }, { name: 'noise', label: 'Noise', prop: 'noise', kind: 'slider', range: [0, 1, 0.3] }] },
  { id: 'oldFilm', label: 'Old Film', make: () => new OldFilmFilter(), amountProp: 'noise', amount: [0, 1, 0.3], animateTime: true, timeProp: 'seed',
    knobs: [{ name: 'sepia', label: 'Sepia', prop: 'sepia', kind: 'slider', range: [0, 1, 0.3] }, { name: 'scratch', label: 'Scratch', prop: 'scratch', kind: 'slider', range: [-1, 1, 0.5] }, { name: 'vig', label: 'Vignette', prop: 'vignetting', kind: 'slider', range: [0, 1, 0.3] }] },
  { id: 'emboss', label: 'Emboss', make: () => new EmbossFilter(), amountProp: 'strength', amount: [0, 20, 5], amountStep: 0.5, knobs: [] },

  // — On/off only —
  { id: 'crossHatch', label: 'Cross Hatch', make: () => new CrossHatchFilter(), amountProp: '', amount: [0, 1, 1], knobs: [] },
  { id: 'grayscale', label: 'Grayscale', make: () => new GrayscaleFilter(), amountProp: '', amount: [0, 1, 1], knobs: [] },
];
