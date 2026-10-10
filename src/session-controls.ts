import type { Button } from './protocol.js';
import type { MapView } from './session-ipc.js';
import type { QuickCommand } from './quick-commands.js';

// Routes captured controller presses and popup keys through the Padcode session contexts.
export type Context = 'agent' | 'menu' | 'confirm' | 'history' | 'draft' | 'map' | 'commands';
export type HistoryCommand = 'enter' | 'up' | 'down' | 'page-up' | 'page-down' | 'exit';
export type MenuKey = 'up' | 'down' | 'confirm' | 'back';
export interface MenuView { title: string; items: string[]; selected: number; hint: string; body?: string; map?: MapView }
export interface ControlEffects {
  capture(handler: (button: Button) => void, status: string): void;
  release(resume: boolean): void;
  interrupt(): void;
  clear?(): void;
  showMenu(view: MenuView | null): void;
  history(command: HistoryCommand): void;
  end(): void;
  hasRecording?(): boolean;
  play?(): void;
  notice?(text: string): void;
  insert?(text: string): void;
  canUndo?(): boolean;
  undo?(rerecord: boolean): void;
  mapProfile?(): Pick<MapView, 'agent' | 'voice'>;
  commands?(): QuickCommand[];
  type?(keys: string): void;
}
export const menuItems = ['Resume Agent controls', 'Pause gamepad mapping', 'Browse history', 'Send interrupt (Esc)', 'Clear input', 'Quick commands', 'Controller map', 'End session...'];
const menuIds = ['resume', 'pause', 'history', 'interrupt', 'clear', 'commands', 'map', 'end'] as const;
type MenuId = typeof menuIds[number] | 'play' | 'draft' | 'undo' | 'rerecord';
export const draftItems = ['Insert into Agent', 'Keep draft', 'Rerecord', 'Discard'];
export const confirmItems = ['Keep the session running', 'End the Agent session'];
const statuses = {
  menu: 'MENU / D-pad select, {confirm} confirm, {back} back',
  confirm: 'END SESSION? / {confirm} confirm, {back} back',
  history: 'HISTORY / D-pad scroll, {l1}/{r1} page, {back} exit',
  draft: 'VOICE DRAFT / {confirm} choose, {back} keep',
  map: 'CONTROLLER MAP / {back} back, {confirm} or {menu} close',
  commands: 'COMMANDS / D-pad select, {confirm} type, {back} back',
};
const keyFor: Partial<Record<Button, MenuKey>> = { dpad_up: 'up', dpad_down: 'down', south: 'confirm', east: 'back' };

export class SessionControls {
  context: Context = 'agent';
  private selected = 0;
  // The reviewed draft stays here, outside the Agent, until it is discarded or replaced.
  draftText: string | undefined;
  // Quick commands opened from the controls menu return there on O; opened with Share they close.
  private commandsFromMenu = false;
  constructor(private fx: ControlEffects) {}
  // Play last recording appears before End session only while a recording exists.
  private entries(): { id: MenuId; label: string }[] {
    const entries: { id: MenuId; label: string }[] = menuIds.map((id, index) => ({ id, label: menuItems[index]! }))
      .filter(entry => entry.id !== 'commands' || this.commandList().length > 0);
    // Voice actions sit together just before End session.
    const voice = entries.length - 1;
    if (this.fx.hasRecording?.()) entries.splice(voice, 0, { id: 'play', label: 'Play last recording' });
    if (this.draftText) entries.splice(voice, 0, { id: 'draft', label: 'Review voice draft' });
    if (this.fx.canUndo?.()) entries.splice(voice, 0, { id: 'undo', label: 'Undo voice insert' }, { id: 'rerecord', label: 'Undo and rerecord' });
    return entries;
  }
  private endIndex(): number { return this.entries().findIndex(entry => entry.id === 'end'); }
  private view(): MenuView {
    if (this.context === 'map') return { title: 'CONTROLLER MAP / {padName}', items: ['Back to menu'], selected: 0, hint: '{back} / Esc back   {confirm} / {menu} close', map: this.fx.mapProfile?.() ?? { agent: 'basic', voice: false } };
    if (this.context === 'commands') return { title: 'QUICK COMMANDS', items: this.commandList().map(entry => entry.label), selected: this.selected, hint: '{confirm} / Enter type   {back} / Esc back' };
    if (this.context === 'draft') return { title: 'VOICE DRAFT', items: draftItems, selected: this.selected, hint: '{confirm} / Enter choose   {back} / Esc keep draft', body: this.draftText ?? '' };
    return this.context === 'confirm'
      ? { title: 'END SESSION?', items: confirmItems, selected: this.selected, hint: '{confirm} / Enter confirm   {back} / Esc back' }
      : { title: 'PADCODE CONTROLS', items: this.entries().map(entry => entry.label), selected: this.selected, hint: '{confirm} / Enter confirm   {back} / Esc close' };
  }
  private commandList(): QuickCommand[] { return this.fx.commands?.() ?? []; }
  private enter(context: Exclude<Context, 'agent'>, selected = 0): void {
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
  openCommands(): void { if (this.context === 'agent' && this.commandList().length) { this.commandsFromMenu = false; this.enter('commands'); } }
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
    // Share again closes Quick commands, like Options closes every context.
    if (button === 'back' && this.context === 'commands') { this.close(); return; }
    const key = keyFor[button];
    if (key) this.key(key);
  }
  key(key: MenuKey, index?: number): void {
    // The map has one row: O returns to the menu on the map item, X closes everything.
    if (this.context === 'map') { if (key === 'back') this.enter('menu', this.entries().findIndex(entry => entry.id === 'map')); else if (key === 'confirm') this.close(); return; }
    if (this.context !== 'menu' && this.context !== 'confirm' && this.context !== 'draft' && this.context !== 'commands') return;
    const items = this.context === 'menu' ? this.entries() : this.context === 'draft' ? draftItems : this.context === 'commands' ? this.commandList() : confirmItems;
    if (index !== undefined) { if (index < 0 || index >= items.length) return; this.selected = index; key = 'confirm'; }
    if (key === 'up' || key === 'down') {
      this.selected = (this.selected + (key === 'up' ? -1 : 1) + items.length) % items.length;
      this.fx.showMenu(this.view()); return;
    }
    if (key === 'back') {
      if (this.context === 'confirm') this.enter('menu', this.endIndex());
      else if (this.context === 'commands' && this.commandsFromMenu) this.enter('menu', this.entries().findIndex(entry => entry.id === 'commands'));
      else this.close();
      return;
    }
    // Typed, never sent: the Agent's own picker opens and the player confirms there.
    if (this.context === 'commands') { const command = this.commandList()[this.selected]; if (command) this.fx.type?.(command.keys); this.close(); return; }
    if (this.context === 'draft') {
      const text = this.draftText;
      if (this.selected >= 2) { this.draftText = undefined; this.fx.notice?.(this.selected === 2 ? 'DRAFT DISCARDED / Hold {l2} to record again' : 'DRAFT DISCARDED'); }
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
    else if (id === 'clear') { this.fx.clear?.(); this.close(); }
    else if (id === 'commands') { this.commandsFromMenu = true; this.enter('commands'); }
    else if (id === 'map') this.enter('map');
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
