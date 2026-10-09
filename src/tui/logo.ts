import type { Caps } from './caps.js';
import { gradient } from './theme.js';

// ANSI Shadow block letters (Unicode), a figlet-style ASCII fallback and a one-line wordmark.
const full = [
  '██████╗  █████╗ ██████╗  ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██████╔╝███████║██║  ██║██║     ██║   ██║██║  ██║█████╗  ',
  '██╔═══╝ ██╔══██║██║  ██║██║     ██║   ██║██║  ██║██╔══╝  ',
  '██║     ██║  ██║██████╔╝╚██████╗╚██████╔╝██████╔╝███████╗',
  '╚═╝     ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
];
const ascii = [
  ' ____   _    ____   ____ ___  ____  _____ ',
  '|  _ \\ / \\  |  _ \\ / ___/ _ \\|  _ \\| ____|',
  '| |_) / _ \\ | | | | |  | | | | | | |  _|  ',
  '|  __/ ___ \\| |_| | |__| |_| | |_| | |___ ',
  '|_| /_/   \\_\\____/ \\____\\___/|____/|_____|',
];
const wordmark = ['P A D C O D E'];
export type LogoVariant = 'full' | 'ascii' | 'wordmark';
export const logoArt: Record<LogoVariant, readonly string[]> = { full, ascii, wordmark };

// The largest variant that fits `width` and the terminal's character set.
export function logoVariant(caps: Caps, width: number): LogoVariant {
  if (caps.unicode && width >= full[0]!.length) return 'full';
  return width >= ascii[0]!.length ? 'ascii' : 'wordmark';
}
// `shine` (0..1) places the sweep highlight; every line shares one ramp so columns stay in step.
export function logo(caps: Caps, variant: LogoVariant, shine?: number): string[] {
  return logoArt[variant].map(line => gradient(caps, line, shine === undefined ? {} : { shine }));
}
