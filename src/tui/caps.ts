// What the terminal can show. Components take these instead of reading the environment themselves.
export type ColorDepth = 0 | 16 | 256 | 24;
export interface Caps { color: ColorDepth; unicode: boolean; motion: boolean; width: number; height: number }
export interface TermStream { isTTY?: boolean; columns?: number; rows?: number }

export function detectCaps(env: NodeJS.ProcessEnv, stream: TermStream): Caps {
  const tty = Boolean(stream.isTTY), term = env.TERM ?? '';
  const color: ColorDepth = !tty || env.NO_COLOR !== undefined || term === 'dumb' || env.FORCE_COLOR === '0' ? 0
    : /^(truecolor|24bit)$/i.test(env.COLORTERM ?? '') ? 24 : /256color/.test(term) ? 256 : 16;
  // Unicode is the default; PADCODE_ASCII covers terminals that draw ambiguous-width characters double wide.
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  const ascii = (env.PADCODE_ASCII !== undefined && env.PADCODE_ASCII !== '0') || term === 'dumb' || term === 'linux' || (locale !== '' && !/utf-?8/i.test(locale));
  return {
    color, unicode: !ascii,
    motion: tty && color > 0 && env.CI === undefined && env.PADCODE_NO_ANIM === undefined,
    width: stream.columns && stream.columns > 0 ? stream.columns : 80,
    height: stream.rows && stream.rows > 0 ? stream.rows : 24,
  };
}
// Content width shared by the full-screen Hub and the inline screens, so both end at the same column.
export const contentWidth = (columns: number) => Math.max(12, Math.min(78, columns - 1));
