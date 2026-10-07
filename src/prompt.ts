import { createInterface, type Interface } from 'node:readline/promises';
import { colorEnabled, safeLabel } from './ui.js';

export interface Choice { label: string; value: string }
export interface PromptPort {
  banner(title: string): void;
  say(text: string): void;
  ask(message: string): Promise<string>;
  choose(message: string, choices: Choice[], selected?: number): Promise<string>;
}
export class TerminalPrompt implements PromptPort {
  private lines: Interface;
  private closed = false;
  private color = colorEnabled(process.env, Boolean(process.stdout.isTTY));
  constructor(private signal: AbortSignal, cancel: () => void) {
    this.lines = createInterface({ input: process.stdin, output: process.stdout, terminal: process.env.TERM !== 'dumb' });
    this.lines.on('SIGINT', cancel);
    this.lines.on('close', () => { if (!this.closed) cancel(); });
  }
  banner(title: string): void {
    const width = Math.max(12, Math.min(72, (process.stdout.columns || 80) - 1));
    this.say('');
    process.stdout.write(this.color ? '\x1b[1;96m' : '');
    this.say('='.repeat(width)); this.say(`P A D C O D E  //  ${title}`); this.say('='.repeat(width));
    process.stdout.write(this.color ? '\x1b[0m' : '');
  }
  say(text: string): void {
    // Device names / config values must never introduce terminal control sequences.
    const line = safeLabel(text), width = Math.max(12, Math.min(72, (process.stdout.columns || 80) - 1));
    if (!line) { process.stdout.write('\n'); return; }
    for (let offset = 0; offset < line.length; offset += width) process.stdout.write(`${line.slice(offset, offset + width)}\n`);
  }
  async ask(message: string): Promise<string> {
    this.signal.throwIfAborted();
    return await this.lines.question(`${this.color ? '\x1b[95m' : ''}> ${safeLabel(message)}${this.color ? '\x1b[0m' : ''} `, { signal: this.signal });
  }
  async choose(message: string, choices: Choice[], selected = 0): Promise<string> {
    this.say(message);
    choices.forEach((choice, index) => this.say(`  ${index === selected ? '>' : ' '} [${index + 1}] ${choice.label}`));
    for (;;) {
      const answer = (await this.ask(`Select [${selected + 1}] (q to cancel):`)).trim();
      if (answer.toLowerCase() === 'q') throw new Error('Setup cancelled.');
      const index = answer === '' ? selected : /^[0-9]+$/.test(answer) ? Number(answer) - 1 : -1;
      if (choices[index]) return choices[index]!.value;
      this.say('Choose one of the displayed numbers.');
    }
  }
  close(): void {
    this.closed = true;
    this.lines.close();
    // Explicitly release input ownership before exiting or entering another mode.
    process.stdin.pause();
  }
}
