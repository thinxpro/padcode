import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents, type Key } from 'node:readline';
import { colorEnabled, safeText } from './ui.js';
import { wrapText } from './text-width.js';
import { formatGlyphs } from './glyphs.js';
import type { MenuInput, MenuAction } from './menu-controller.js';

export interface Choice { label: string; value: string }
export interface PromptPort {
  banner(title: string): void;
  say(text: string): void;
  ask(message: string): Promise<string>;
  choose(message: string, choices: Choice[], selected?: number): Promise<string>;
}
export class TerminalPrompt implements PromptPort {
  private color = colorEnabled(process.env, Boolean(process.stdout.isTTY));
  constructor(private signal: AbortSignal, private cancel: () => void, private gamepad?: MenuInput) {}
  // Button names follow the connected controller ({confirm}, {back}, {menu}...).
  private names(text: string): string { return formatGlyphs(text, this.gamepad?.glyphs?.() ?? { family: 'standard' }); }
  private width(): number { return Math.max(12, Math.min(72, (process.stdout.columns || 80) - 1)); }
  private wrap(text: string): string[] {
    // Wrap by terminal columns so Chinese and emoji keep their characters and line up.
    const lines = wrapText(safeText(this.names(text)), this.width());
    return lines.length ? lines : [''];
  }
  banner(title: string): void {
    this.say('');
    process.stdout.write(this.color ? '\x1b[1;96m' : '');
    this.say('='.repeat(this.width())); this.say(`P A D C O D E  //  ${title}`); this.say('='.repeat(this.width()));
    process.stdout.write(this.color ? '\x1b[0m' : '');
  }
  say(text: string): void { process.stdout.write(this.wrap(text).join('\n') + '\n'); }
  async ask(message: string): Promise<string> {
    this.signal.throwIfAborted();
    this.say('KEYBOARD INPUT / Type text here; gamepad buttons do not enter text.');
    const lines = createInterface({ input: process.stdin, output: process.stdout, terminal: process.env.TERM !== 'dumb' });
    let answered = false;
    lines.on('SIGINT', this.cancel);
    lines.on('close', () => { if (!answered) this.cancel(); });
    try {
      const answer = await lines.question(`${this.color ? '\x1b[95m' : ''}> ${safeText(this.names(message))}${this.color ? '\x1b[0m' : ''} `, { signal: this.signal });
      answered = true; return answer;
    } finally { answered = true; lines.close(); process.stdin.pause(); }
  }
  async choose(message: string, choices: Choice[], selected = 0): Promise<string> {
    this.signal.throwIfAborted();
    if (!choices.length || !choices[selected]) throw new Error('Menu has no valid default selection.');
    const input = process.stdin, wasRaw = Boolean(input.isRaw);
    const ansi = Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb';
    let rows = 0, typed = '', status = this.gamepad ? this.gamepad.statusText ?? 'D-PAD select / {confirm} confirm / {back} back / keyboard available' : 'Arrow keys or numbers / Enter confirm';
    const render = () => {
      if (ansi && rows) process.stdout.write(`\r\x1b[${rows}A\x1b[0J`);
      const lines = [message, ...choices.map((choice, index) => `  ${index === selected ? '>' : ' '} [${index + 1}] ${choice.label}`), status, `> Select [${selected + 1}] (q to cancel):`].flatMap(text => this.wrap(text));
      rows = lines.length;
      process.stdout.write(lines.map(line => this.color && line.startsWith('  >') ? `\x1b[1;96m${line}\x1b[0m` : line).join('\n') + '\n');
    };
    emitKeypressEvents(input);
    input.setRawMode?.(true); input.resume();
    try {
      return await new Promise<string>((resolve, reject) => {
        let done = false;
        let offAction = () => {}, offStatus = () => {};
        const finish = (value?: string, error?: Error) => {
          if (done) return; done = true;
          input.removeListener('keypress', keypress); input.removeListener('end', ended);
          process.stdout.removeListener('resize', resized);
          this.signal.removeEventListener('abort', abort); offAction(); offStatus();
          if (error) reject(error); else resolve(value!);
        };
        const abort = () => finish(undefined, new Error('Setup cancelled.'));
        const ended = () => { this.cancel(); abort(); };
        const action = (action: MenuAction) => {
          if (done) return;
          typed = '';
          if (action === 'up' || action === 'down') { selected = (selected + (action === 'up' ? -1 : 1) + choices.length) % choices.length; render(); }
          else if (action === 'confirm') finish(choices[selected]!.value);
          else {
            const back = choices.find(choice => ['back', 'cancel', 'exit', 'quit'].includes(choice.value));
            if (back) finish(back.value); else abort();
          }
        };
        const keypress = (text: string | undefined, key: Key) => {
          if (done) return;
          if (key.ctrl && (key.name === 'c' || key.name === 'd')) { this.cancel(); abort(); return; }
          if (key.name === 'up' || key.name === 'down') { action(key.name); return; }
          if (key.name === 'escape') { action('cancel'); return; }
          if (text?.toLowerCase() === 'q') { abort(); return; }
          if (key.name === 'return' || key.name === 'enter') {
            process.stdout.write('\n');
            const index = typed ? Number(typed) - 1 : selected;
            if (choices[index]) finish(choices[index]!.value);
            else { typed = ''; this.say('Choose one of the displayed numbers.'); rows = 0; render(); }
          } else if (key.name === 'backspace' && typed) { typed = typed.slice(0, -1); process.stdout.write('\b \b'); }
          else if (text && /^[0-9]$/.test(text) && typed.length < 6) { typed += text; process.stdout.write(text); }
        };
        const resized = () => { rows = 0; render(); };
        input.on('keypress', keypress); input.on('end', ended); process.stdout.on('resize', resized);
        this.signal.addEventListener('abort', abort, { once: true });
        offAction = this.gamepad?.subscribeAction(action) ?? offAction;
        offStatus = this.gamepad?.subscribeStatus(text => { status = text; render(); }) ?? offStatus;
        render();
      });
    } finally { input.setRawMode?.(wasRaw); input.pause(); }
  }
  close(): void { process.stdin.pause(); }
}
