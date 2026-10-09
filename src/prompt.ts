import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents, type Key } from 'node:readline';
import { safeText } from './ui.js';
import { askHint, askPrompt, renderBanner, renderMenu, renderMessage, selectLine, type Progress } from './prompt-view.js';
import { formatGlyphs } from './glyphs.js';
import type { MenuInput, MenuAction } from './menu-controller.js';
import type { Glyphs } from './glyphs.js';
import { contentWidth, detectCaps, Screen, type Caps } from './tui/index.js';

export interface Choice { label: string; value: string }
// What a full-screen menu frame needs; `shine` is set while the intro sweep plays.
export interface ScreenView { selected: number; status: string; flash: string; shine: number | undefined; caps: Caps; glyphs: Glyphs }
interface SelectView {
  draw(selected: number, status: string): void;
  typed(text: string, erase: boolean): void;
  submit(): void;
  invalid(selected: number, status: string): void;
  resized(selected: number, status: string): void;
  input?(): void;
  start?(): void;
  jump?: boolean;
}
export interface PromptPort {
  banner(title: string, progress?: Progress): void;
  say(text: string): void;
  ask(message: string): Promise<string>;
  choose(message: string, choices: Choice[], selected?: number): Promise<string>;
}
export class TerminalPrompt implements PromptPort {
  constructor(private signal: AbortSignal, private cancel: () => void, private gamepad?: MenuInput) {}
  private caps(): Caps { return detectCaps(process.env, process.stdout); }
  // Button names follow the connected controller ({confirm}, {back}, {menu}...).
  private names(text: string): string { return formatGlyphs(text, this.gamepad?.glyphs?.() ?? { family: 'standard' }); }
  private width(): number { return contentWidth(process.stdout.columns || 80); }
  private clean(text: string): string { return safeText(this.names(text)); }
  banner(title: string, progress?: Progress): void {
    process.stdout.write(renderBanner(this.clean(title), this.caps(), this.width(), progress).join('\n') + '\n');
  }
  // Wraps by terminal columns so Korean, kana and emoji keep their characters and line up.
  say(text: string): void { process.stdout.write(renderMessage(this.clean(text), this.caps(), this.width()).join('\n') + '\n'); }
  async ask(message: string): Promise<string> {
    this.signal.throwIfAborted();
    const caps = this.caps();
    process.stdout.write(askHint(caps, this.width()).join('\n') + '\n');
    const lines = createInterface({ input: process.stdin, output: process.stdout, terminal: process.env.TERM !== 'dumb' });
    let answered = false;
    lines.on('SIGINT', this.cancel);
    lines.on('close', () => { if (!answered) this.cancel(); });
    try {
      const answer = await lines.question(askPrompt(this.clean(message), caps), { signal: this.signal });
      answered = true; return answer;
    } finally { answered = true; lines.close(); process.stdin.pause(); }
  }
  async choose(message: string, choices: Choice[], selected = 0): Promise<string> {
    const ansi = Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb';
    let rows = 0;
    const render = (index: number, status: string) => {
      if (ansi && rows) process.stdout.write(`\r\x1b[${rows}A\x1b[0J`);
      const caps = this.caps();
      const lines = [...renderMenu(this.clean(message), choices.map(choice => this.clean(choice.label)), index, safeText(status), caps, this.width()), selectLine(index, caps)];
      rows = lines.length;
      process.stdout.write(lines.join('\n') + '\n');
    };
    return this.select(choices, selected, {
      draw: render,
      typed: (text, erase) => process.stdout.write(erase ? '\b \b' : text),
      submit: () => process.stdout.write('\n'),
      invalid: (index, status) => { this.say('Choose one of the displayed numbers.'); rows = 0; render(index, status); },
      resized: (index, status) => { rows = 0; render(index, status); },
    }, 'Arrow keys or numbers / Enter confirm');
  }
  // Full-screen menu on the alternate screen; `render` returns the whole frame. A digit moves the cursor.
  async screen(choices: Choice[], render: (view: ScreenView) => string[], options: { selected?: number; intro?: number } = {}): Promise<string> {
    const screen = new Screen(process.stdout, process, Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb');
    let flash = '', shine: number | undefined, timer: NodeJS.Timeout | undefined, index = options.selected ?? 0, status = '';
    const caps = () => detectCaps(process.env, process.stdout);
    const draw = () => screen.draw(render({ selected: index, status, flash, shine, caps: caps(), glyphs: this.gamepad?.glyphs?.() ?? { family: 'standard' } }));
    const stopIntro = () => { if (timer) { clearInterval(timer); timer = undefined; shine = undefined; } };
    const intro = options.intro ?? 0;
    try {
      return await this.select(choices, index, {
        draw: (selected, text) => { index = selected; status = text; draw(); },
        typed: () => {},
        submit: () => {},
        invalid: () => { flash = `Choose 1-${choices.length}.`; draw(); flash = ''; },
        resized: () => draw(),
        input: () => { if (timer) { stopIntro(); draw(); } },
        jump: true,
        start: () => {
          screen.enter();
          if (intro > 0 && caps().motion) {
            const began = Date.now();
            shine = 0;
            timer = setInterval(() => {
              const t = (Date.now() - began) / intro;
              if (t >= 1) stopIntro(); else shine = t;
              draw();
            }, 33);
          }
        },
      }, 'Arrow keys or numbers / Enter confirm');
    } finally { stopIntro(); screen.leave(); }
  }
  private async select(choices: Choice[], selected: number, view: SelectView, keyboard: string): Promise<string> {
    this.signal.throwIfAborted();
    if (!choices.length || !choices[selected]) throw new Error('Menu has no valid default selection.');
    const input = process.stdin, wasRaw = Boolean(input.isRaw);
    let typed = '', status = this.gamepad ? this.gamepad.statusText ?? 'D-PAD select / {confirm} confirm / {back} back / keyboard available' : keyboard;
    const render = () => view.draw(selected, this.names(status));
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
          view.input?.();
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
          view.input?.();
          if (key.name === 'up' || key.name === 'down') { action(key.name); return; }
          if (key.name === 'escape') { action('cancel'); return; }
          if (text?.toLowerCase() === 'q') { abort(); return; }
          if (key.name === 'return' || key.name === 'enter') {
            view.submit();
            const index = typed ? Number(typed) - 1 : selected;
            if (choices[index]) finish(choices[index]!.value);
            else { typed = ''; view.invalid(selected, this.names(status)); }
          } else if (view.jump && text && /^[0-9]$/.test(text)) {
            const index = Number(text) - 1;
            if (choices[index]) { selected = index; render(); } else view.invalid(selected, this.names(status));
          } else if (key.name === 'backspace' && typed) { typed = typed.slice(0, -1); view.typed('', true); }
          else if (text && /^[0-9]$/.test(text) && typed.length < 6) { typed += text; view.typed(text, false); }
        };
        const resized = () => view.resized(selected, this.names(status));
        input.on('keypress', keypress); input.on('end', ended); process.stdout.on('resize', resized);
        this.signal.addEventListener('abort', abort, { once: true });
        offAction = this.gamepad?.subscribeAction(action) ?? offAction;
        offStatus = this.gamepad?.subscribeStatus(text => { status = text; render(); }) ?? offStatus;
        view.start?.();
        render();
      });
    } finally { input.setRawMode?.(wasRaw); input.pause(); }
  }
  close(): void { process.stdin.pause(); }
}
