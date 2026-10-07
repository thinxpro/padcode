import type { Button } from './protocol.js';

// Routes captured controller presses and popup keys through the Padcode session contexts.
export type Context = 'agent' | 'menu' | 'confirm' | 'history';
export type HistoryCommand = 'enter' | 'up' | 'down' | 'page-up' | 'page-down' | 'exit';
export type MenuKey = 'up' | 'down' | 'confirm' | 'back';
export interface MenuView { title: string; items: string[]; selected: number; hint: string }
export interface ControlEffects {
  capture(handler: (button: Button) => void, status: string): void;
  release(resume: boolean): void;
  interrupt(): void;
  showMenu(view: MenuView | null): void;
  history(command: HistoryCommand): void;
  end(): void;
}
export const menuItems = ['Resume Agent controls', 'Pause gamepad mapping', 'Browse history', 'Send interrupt (Ctrl+C)', 'End session...'];
export const confirmItems = ['Keep the session running', 'End the Agent session'];
const statuses = {
  menu: 'MENU / D-pad select, X confirm, O back',
  confirm: 'END SESSION? / X confirm, O back',
  history: 'HISTORY / D-pad scroll, L1/R1 page, O exit',
};
const keyFor: Partial<Record<Button, MenuKey>> = { dpad_up: 'up', dpad_down: 'down', south: 'confirm', east: 'back' };

export class SessionControls {
  context: Context = 'agent';
  private selected = 0;
  constructor(private fx: ControlEffects) {}
  private view(): MenuView {
    return this.context === 'confirm'
      ? { title: 'END SESSION?', items: confirmItems, selected: this.selected, hint: 'X / Enter confirm   O / Esc back' }
      : { title: 'PADCODE CONTROLS', items: menuItems, selected: this.selected, hint: 'X / Enter confirm   O / Esc close' };
  }
  private enter(context: 'menu' | 'confirm' | 'history', selected = 0): void {
    this.context = context; this.selected = selected;
    this.fx.capture(button => this.button(button), statuses[context]);
    this.fx.showMenu(context === 'history' ? null : this.view());
  }
  private close(resume = true): void {
    const leaving = this.context;
    if (leaving === 'agent') return;
    this.context = 'agent';
    if (leaving === 'history') this.fx.history('exit'); else this.fx.showMenu(null);
    this.fx.release(resume);
  }
  openMenu(): void { if (this.context === 'agent') this.enter('menu'); }
  button(button: Button): void {
    if (this.context === 'agent') return;
    if (button === 'start') { this.close(); return; }
    if (this.context === 'history') {
      const command = ({ dpad_up: 'up', dpad_down: 'down', left_shoulder: 'page-up', right_shoulder: 'page-down' } as Partial<Record<Button, HistoryCommand>>)[button];
      if (command) this.fx.history(command); else if (button === 'east') this.close();
      return;
    }
    const key = keyFor[button];
    if (key) this.key(key);
  }
  key(key: MenuKey, index?: number): void {
    if (this.context !== 'menu' && this.context !== 'confirm') return;
    const items = this.context === 'menu' ? menuItems : confirmItems;
    if (index !== undefined) { if (index < 0 || index >= items.length) return; this.selected = index; key = 'confirm'; }
    if (key === 'up' || key === 'down') {
      this.selected = (this.selected + (key === 'up' ? -1 : 1) + items.length) % items.length;
      this.fx.showMenu(this.view()); return;
    }
    if (key === 'back') { if (this.context === 'confirm') this.enter('menu', 4); else this.close(); return; }
    if (this.context === 'confirm') {
      if (this.selected === 1) { this.fx.showMenu(null); this.context = 'agent'; this.fx.end(); }
      else this.enter('menu', 4);
      return;
    }
    if (this.selected === 0) this.close();
    else if (this.selected === 1) this.close(false);
    else if (this.selected === 2) { this.enter('history'); this.fx.history('enter'); }
    else if (this.selected === 3) { this.fx.interrupt(); this.close(); }
    else this.enter('confirm');
  }
  // tmux reports history mode changes for mouse-wheel entry and for exits such as scrolling past the bottom.
  historyEntered(): void { if (this.context !== 'history') this.enter('history'); }
  historyLeft(): void { if (this.context === 'history') { this.context = 'agent'; this.fx.release(true); } }
  // Disconnects and Agent exit close every Padcode context without acting on the Agent.
  lost(): void {
    const leaving = this.context;
    this.context = 'agent';
    if (leaving === 'history') this.fx.history('exit');
    else if (leaving !== 'agent') this.fx.showMenu(null);
    if (leaving !== 'agent') this.fx.release(true);
  }
}
