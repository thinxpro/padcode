import type { Caps } from './caps.js';
// Semantic tones; screens name a role, never a raw colour code.
export type Tone = 'brand' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'text' | 'muted';
export type Rgb = readonly [number, number, number];
export interface Style { tone?: Tone; bold?: boolean; dim?: boolean; inverse?: boolean }

const tones: Record<Tone, { rgb: Rgb; c256: number; c16: number }> = {
  brand: { rgb: [0, 215, 255], c256: 45, c16: 96 },
  accent: { rgb: [255, 95, 215], c256: 206, c16: 95 },
  ok: { rgb: [95, 215, 135], c256: 78, c16: 92 },
  warn: { rgb: [255, 200, 70], c256: 221, c16: 93 },
  danger: { rgb: [255, 85, 85], c256: 203, c16: 91 },
  info: { rgb: [120, 170, 255], c256: 111, c16: 94 },
  text: { rgb: [220, 224, 232], c256: 253, c16: 37 },
  muted: { rgb: [128, 134, 150], c256: 245, c16: 90 },
};
export const brandRamp: readonly [Rgb, Rgb] = [tones.brand.rgb, tones.accent.rgb];
export const reset = '\x1b[0m';

function foreground(caps: Caps, rgb: Rgb, c256: number, c16: number): string {
  return caps.color === 24 ? `38;2;${rgb.join(';')}` : caps.color === 256 ? `38;5;${c256}` : String(c16);
}
// Nearest index in the 6x6x6 cube of the 256-colour palette.
function cube(rgb: Rgb): number {
  const level = (v: number) => v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40));
  return 16 + 36 * level(rgb[0]) + 6 * level(rgb[1]) + level(rgb[2]);
}
export function sgr(caps: Caps, style: Style): string {
  if (!caps.color) return '';
  const codes: string[] = [];
  if (style.bold) codes.push('1');
  if (style.dim) codes.push('2');
  if (style.inverse) codes.push('7');
  if (style.tone) { const t = tones[style.tone]; codes.push(foreground(caps, t.rgb, t.c256, t.c16)); }
  return codes.length ? `\x1b[${codes.join(';')}m` : '';
}
export function paint(caps: Caps, text: string, style: Style): string {
  const open = sgr(caps, style);
  return open && text ? `${open}${text}${reset}` : text;
}
export interface GradientOptions { ramp?: readonly [Rgb, Rgb]; offset?: number; bold?: boolean; shine?: number }
const white: Rgb = [255, 255, 255];
// Colours each column along a ramp. `offset` (0..1) shifts the ramp; `shine` (0..1) places a white
// highlight band that moves across the text for the welcome sweep.
export function gradient(caps: Caps, text: string, options: GradientOptions = {}): string {
  const { ramp = brandRamp, offset = 0, bold = true, shine } = options;
  if (!caps.color || !text) return text;
  const chars = [...text], span = Math.max(1, chars.length - 1);
  // The band is about a sixth of the text wide and starts and ends fully outside it.
  const band = Math.max(2, chars.length / 6), at = shine === undefined ? undefined : -band + shine * (chars.length + 2 * band);
  const glow = (i: number) => at === undefined ? 0 : Math.max(0, 1 - Math.abs(i - at) / band);
  let out = '', last = '';
  chars.forEach((char, i) => {
    if (char === ' ') { out += char; return; }
    let code: string;
    if (caps.color === 16) code = `\x1b[${bold ? '1;' : ''}${glow(i) > 0.5 ? 97 : 96}m`;
    else {
      const t = ((i / span + offset) % 1 + 1) % 1, k = t <= 0.5 ? t * 2 : (1 - t) * 2, g = glow(i);
      const base = ramp[0].map((from, c) => from + (ramp[1][c]! - from) * k);
      const rgb = base.map((v, c) => Math.round(v + (white[c]! - v) * g)) as unknown as Rgb;
      code = `\x1b[${bold ? '1;' : ''}${foreground(caps, rgb, cube(rgb), 96)}m`;
    }
    out += (code === last ? '' : code) + char; last = code;
  });
  return `${out}${reset}`;
}
