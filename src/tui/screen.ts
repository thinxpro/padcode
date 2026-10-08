// A full-screen view: alternate screen and hidden cursor on a TTY, plain lines otherwise.
export interface ScreenStream { isTTY?: boolean; write(chunk: string): unknown }
export interface ExitHooks { once(event: 'exit', listener: () => void): unknown; removeListener(event: 'exit', listener: () => void): unknown }

export class Screen {
  private active = false;
  private readonly restore = () => this.leave();
  constructor(private readonly out: ScreenStream, private readonly hooks: ExitHooks = process) {}
  get tty(): boolean { return Boolean(this.out.isTTY); }
  enter(): void {
    if (this.active || !this.tty) return;
    this.active = true;
    // Restores the terminal even if the process exits without calling leave().
    this.hooks.once('exit', this.restore);
    this.out.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');
  }
  draw(lines: string[]): void {
    if (!this.active) { this.out.write(lines.join('\n') + '\n'); return; }
    this.out.write(`\x1b[H${lines.map(line => `${line}\x1b[0m\x1b[K`).join('\r\n')}\x1b[J`);
  }
  leave(): void {
    if (!this.active) return;
    this.active = false;
    this.hooks.removeListener('exit', this.restore);
    this.out.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  }
}
