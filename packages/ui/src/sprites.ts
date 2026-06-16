import type { Tribe } from '@game/core';

/**
 * Pixel-art sprites: 16×16 palette-indexed matrices (validated from the design
 * pass), rendered to a canvas. Index 0 is transparent; chars are hex (0–f).
 * Palette index 2 is the beast amber; the rest follow tribe colors.
 */
const SPAL: (number | null)[] = [
  null, 0x222530, 0xd99a4e, 0xff5a4f, 0xf6c751, 0xf6f8fc, 0x5fc6e0, 0x357f99, 0xc56cd8, 0x7a3a90,
  0xff9a42, 0xc25a1c, 0x66c48c, 0x35784f, 0xc6b083, 0x7c6a4a,
];

export type SpriteName = 'beast' | 'dragon' | 'mech' | 'undead' | 'demon' | 'neutral';

const SPR: Record<SpriteName, string[]> = {
  beast: [
    '0000000000000000', '0011000000110000', '0122100001221000', '0122210000122100',
    '0122222222222100', '0125222222522100', '0122222222222100', '0122222222222100',
    '0012222222222100', '0001222bb2221000', '0000122222210000', '0000012222100000',
    '0000001111000000', '0000000000000000', '0000000000000000', '0000000000000000',
  ],
  dragon: [
    '0000000000000000', '0000a00000a00000', '0001a00000a10000', '0001aaaaaaa10000',
    '001aaaaaaaaaa100', '01aaa5aaaa5aaa10', '01aaa3aaaa3aaa10', '01aaaaaaaaaaaa10',
    '001aaaaaaaaaa100', '0001aaaaaaaa1000', '0011baaaaaab1100', '01baaaaaaaaab100',
    '001aaaaaaaaa1000', '0001100001100000', '0000bb0000bb0000', '0000000000000000',
  ],
  mech: [
    '0000000440000000', '0000000170000000', '0001111111110000', '0011666666661100',
    '0116655555566110', '0166651551566610', '0166655555566610', '0016677777766100',
    '0001166666611000', '0011666666666100', '0166677777776610', '0166677777776610',
    '0166655555566610', '0016666666666100', '0001100001100000', '0007700007700000',
  ],
  undead: [
    '0000000000000000', '0000000000000000', '0000011111100000', '0001cccccccc1000',
    '001cccccccccc100', '01cccccccccccc10', '01ccc1cccc1ccc10', '01cccccccccccc10',
    '01ccdccddccdcc10', '01cccccccccccc10', '001cccccccccc100', '0001cccccccc1000',
    '00011cccccc11000', '0000dddddddd0000', '0000000000000000', '0000000000000000',
  ],
  demon: [
    '0000000000000000', '0000100000010000', '0000180000810000', '0001188888811000',
    '0011888888881100', '0118888888888110', '0118835885388110', '0118888888888110',
    '0118899889988110', '0011888888881100', '0001888888810000', '0000118888110000',
    '0000110000110000', '0000990000990000', '0000000000000000', '0000000000000000',
  ],
  neutral: [
    '0000000000000000', '0000011011000000', '0000111111110000', '0001eeeeeeee1000',
    '001eeeeeeeeee100', '01eeeeeeeeeeee10', '01eee1eeee1eee10', '01eeeeeeeeeeee10',
    '01eeefeeeefeee10', '01eeeeeeeeeeee10', '01eeeeeeeeeeee10', '001eeeeeeeeee100',
    '0001eeeeeeee1000', '0000111111110000', '0000ffffffff0000', '0000000000000000',
  ],
};

/** Tribes map 1:1 to sprite names. Enemy "Omen" filler renders as the undead spore. */
export function spriteForTribe(tribe: Tribe): SpriteName {
  return tribe;
}

export function drawSprite(canvas: HTMLCanvasElement, name: SpriteName, scale: number): void {
  const rows = SPR[name];
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = 16 * scale;
  canvas.height = 16 * scale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < 16; y++) {
    const row = rows[y];
    for (let x = 0; x < 16; x++) {
      const idx = parseInt(row[x], 16);
      if (!idx) continue;
      const color = SPAL[idx];
      if (color == null) continue;
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}
