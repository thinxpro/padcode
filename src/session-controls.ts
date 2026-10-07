import type { Button } from './protocol.js';

// Routes captured controller presses and popup keys through the Padcode session contexts.
export type Context = 'agent' | 'menu' | 'confirm' | 'history' | 'draft';
export type HistoryCommand = 'enter' | 'up' | 'down' | 'page-up' | 'page-down' | 'exit';
export type MenuKey = 'up' | 'down' | 'confirm' | 'back';
export interface MenuView { title: string; items: string[]; selected: number; hint: string; body?: string }
export interface ControlEffects {
  capture(handler: (button: Button) => void, status: string): void;
  release(resume: boolean): void;
  interrupt(): void;
  showMenu(view: MenuView | null): void;
  history(command: HistoryCommand): void;
  end(): void;
  hasRecording?(): boolean;
  play?(): void;
  notice?(text: string): void;
  insert?(text: string): void;
  canUndo?(): boolean;
  undo?(rerecord: boolean): void;
}
export const menuItems = ['Resume Agent controls', 'Pause gamepad mapping', 'Browse history', 'Send interrupt (Esc)', 'End session...'];
const menuIds = ['resume', 'pause', 'history', 'interrupt', 'end'] as const;
type MenuId = typeof menuIds[number] | 'play' | 'draft' | 'undo' | 'rerecord';
export const draftItems = ['Insert into Agent', 'Keep draft', 'Rerecord', 'Discard'];
export const confirmItems = ['Keep the session running', 'End the Agent session'];
const statuses = {
  menu: 'MENU / D-pad select, X confirm, O back',
  confirm: 'END SESSION? / X confirm, O back',
  history: 'HISTORY / D-pad scroll, L1/R1 page, O exit',
  draft: 'VOICE DRAFT / X choose, O keep',
};
const keyFor: Partial<Record<Button, MenuKey>> = { dpad_up: 'up', dpad_down: 'down', south: 'confirm', east: 'back' };

export class SessionControls {
  context: Context = 'agent';
  private selected = 0;
  // The reviewed draft stays here, outside the Agent, until it is discarded or replaced.
  draftText: string | undefined;
  constructor(private fx: ControlEffects) {}
  // Play last recording appears before End session only while a recording exists.
  private entries(): { id: MenuId; label: string }[] {
    const entries: { id: MenuId; label: string }[] = menuIds.map((id, index) => ({ id, label: menuItems[index]! }));
    if (this.fx.hasRecording?.()) entries.splice(4, 0, { id: 'play', label: 'Play last recording' });
    if (this.draftText) entries.splice(4, 0, { id: 'draft', label: 'Review voice draft' });
    if (this.fx.canUndo?.()) entries.splice(4, 0, { id: 'undo', label: 'Undo voice insert' }, { id: 'rerecord', label: 'Undo and rerecord' });
    return entries;
  }
  private endIndex(): number { return this.entries().findIndex(entry => entry.id === 'end'); }
  private view(): MenuView {
    if (this.context === 'draft') return { title: 'VOICE DRAFT', items: draftItems, selected: this.selected, hint: 'X / Enter choose   O / Esc keep draft', body: this.draftText ?? '' };
    return this.context === 'confirm'
      ? { title: 'END SESSION?', items: confirmItems, selected: this.selected, hint: 'X / Enter confirm   O / Esc back' }
      : { title: 'PADCODE CONTROLS', items: this.entries().map(entry => entry.label), selected: this.selected, hint: 'X / Enter confirm   O / Esc close' };
  }
  private enter(context: 'menu' | 'confirm' | 'history' | 'draft', selected = 0): void {
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
  // A finished transcription opens for review right away when the Agent context is free.
  openDraft(text: string): void { this.draftText = text; if (this.context === 'agent') this.enter('draft'); }
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
    if (this.context !== 'menu' && this.context !== 'confirm' && this.context !== 'draft') return;
    const items = this.context === 'menu' ? this.entries() : this.context === 'draft' ? draftItems : confirmItems;
    if (index !== undefined) { if (index < 0 || index >= items.length) return; this.selected = index; key = 'confirm'; }
    if (key === 'up' || key === 'down') {
      this.selected = (this.selected + (key === 'up' ? -1 : 1) + items.length) % items.length;
      this.fx.showMenu(this.view()); return;
    }
    if (key === 'back') { if (this.context === 'confirm') this.enter('menu', this.endIndex()); else this.close(); return; }
    if (this.context === 'draft') {
      const text = this.draftText;
      if (this.selected >= 2) { this.draftText = undefined; this.fx.notice?.(this.selected === 2 ? 'DRAFT DISCARDED / Hold L2 to record again' : 'DRAFT DISCARDED'); }
      this.close();
      if (this.selected === 0 && text) this.fx.insert?.(text);
      return;
    }
    if (this.context === 'confirm') {
      if (this.selected === 1) { this.fx.showMenu(null); this.context = 'agent'; this.fx.end(); }
      else this.enter('menu', this.endIndex());
      return;
    }
    const id = this.entries()[this.selected]!.id;
    if (id === 'resume') this.close();
    else if (id === 'pause') this.close(false);
    else if (id === 'history') { this.enter('history'); this.fx.history('enter'); }
    else if (id === 'interrupt') { this.fx.interrupt(); this.close(); }
    else if (id === 'play') { this.close(); this.fx.play?.(); }
    else if (id === 'draft') this.enter('draft');
    else if (id === 'undo' || id === 'rerecord') { this.close(); this.fx.undo?.(id === 'rerecord'); }
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
