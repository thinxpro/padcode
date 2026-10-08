// Button names per controller family. Logic is positional (SDL's south/east/west/north...); only the
// names shown to people change. ASCII only, so layouts stay aligned in CJK terminals.
export const families = ['playstation', 'xbox', 'nintendo', 'standard'] as const;
export type Family = typeof families[number];
export type Role = 'south' | 'east' | 'west' | 'north' | 'menu' | 'view' | 'l1' | 'r1' | 'l2' | 'r2' | 'l3' | 'r3';
export interface Glyphs { family: Family; swap?: boolean }

const names: Record<Family, Record<Role, string> & { pad: string; padName: string }> = {
  playstation: { south: 'X', east: 'O', west: 'SQ', north: 'TRI', menu: 'OPTIONS', view: 'SHARE', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', l3: 'L3', r3: 'R3', pad: 'PlayStation controller', padName: 'DUALSHOCK / DUALSENSE' },
  xbox: { south: 'A', east: 'B', west: 'X', north: 'Y', menu: 'MENU', view: 'VIEW', l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', l3: 'LS', r3: 'RS', pad: 'Xbox controller', padName: 'XBOX WIRELESS CONTROLLER' },
  nintendo: { south: 'B', east: 'A', west: 'Y', north: 'X', menu: '+', view: '-', l1: 'L', r1: 'R', l2: 'ZL', r2: 'ZR', l3: 'LS', r3: 'RS', pad: 'Nintendo controller', padName: 'SWITCH PRO CONTROLLER' },
  standard: { south: 'A', east: 'B', west: 'X', north: 'Y', menu: 'START', view: 'BACK', l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', l3: 'LS', r3: 'RS', pad: 'gamepad', padName: 'STANDARD GAMEPAD' },
};
export const isFamily = (value: unknown): value is Family => typeof value === 'string' && (families as readonly string[]).includes(value);
export function glyph(role: Role, glyphs: Glyphs): string {
  const table = names[glyphs.family];
  // With the Nintendo-style option, east confirms and south goes back; names follow the buttons.
  if (glyphs.swap && role === 'south') return table.east;
  if (glyphs.swap && role === 'east') return table.south;
  return table[role];
}
const roles: Record<string, Role> = { confirm: 'south', back: 'east', west: 'west', north: 'north', menu: 'menu', view: 'view', l1: 'l1', r1: 'r1', l2: 'l2', r2: 'r2', l3: 'l3', r3: 'r3' };
// Replaces {confirm}, {back}, {west}, {north}, {menu}, {view}, {l1}..{r3}, {pad} and {padName}; other braces stay.
export function formatGlyphs(text: string, glyphs: Glyphs): string {
  return text.replace(/\{(confirm|back|west|north|menu|view|l1|r1|l2|r2|l3|r3|pad|padName)\}/g, (_, key: string) =>
    key === 'pad' ? names[glyphs.family].pad : key === 'padName' ? names[glyphs.family].padName : glyph(roles[key]!, glyphs));
}
// Family guessed from a Bluetooth name before SDL sees the device; only used to pick a pairing hint.
export function familyFromName(name: string): Family | undefined {
  if (/dualsense|dualshock|wireless controller$/i.test(name) && !/xbox/i.test(name)) return 'playstation';
  if (/xbox/i.test(name)) return 'xbox';
  if (/pro controller|joy-con|nintendo/i.test(name)) return 'nintendo';
  return undefined;
}
export const pairingHints: Record<Exclude<Family, 'standard'>, string> = {
  playstation: 'PS4: hold SHARE + PS. PS5: hold CREATE + PS. Wait for the light to flash quickly.',
  xbox: 'Xbox: hold the pair button on top until the Xbox logo flashes quickly.',
  nintendo: 'Switch Pro: hold the small sync button on top until the lights run.',
};
