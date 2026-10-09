import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { EventDecoder, parseEvent } from '../dist/protocol.js';
import { formatGlyphs, glyph, familyFromName, pairingHints, families } from '../dist/glyphs.js';
import { validateConfig } from '../dist/config.js';
import { renderControllerMap, mapWidth } from '../dist/controller-map.js';
import { renderPanel } from '../dist/panel.js';
const asciiCaps = { color: 0, unicode: false, motion: false, width: 200, height: 24 };
import { setup } from '../dist/onboarding.js';
import { GamepadMenus } from '../dist/menu-controller.js';
import { target } from './agent-gamepad-fixture.mjs';

test('A1 protocol: family is optional and validated', () => {
  const base = { v: 1, seq: 1, time: 1, type: 'connected', device: 1, name: 'Pad' };
  for (const family of families) assert.equal(parseEvent(JSON.stringify({ ...base, family })).family, family);
  assert.equal(parseEvent(JSON.stringify(base)).family, undefined);
  for (const family of ['ps4', 'XBOX', 7, '']) assert.throws(() => parseEvent(JSON.stringify({ ...base, family })));
});

test('A2 native helper reports the family of simulated PlayStation, Xbox, Nintendo and unknown gamepads', () => {
  for (const family of families) {
    const r = spawnSync('build/native/padcode-controller', ['--virtual-test', family], { timeout: 10000 });
    assert.equal(r.status, 0, `${family}: ${r.stderr}`);
    const d = new EventDecoder(), events = d.push(r.stdout); d.end();
    assert.equal(events.find(e => e.type === 'connected')?.family, family, family);
  }
  const bad = spawnSync('build/native/padcode-controller', ['--virtual-test', 'sega'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /Usage/);
});

test('A3 button names per family, the Nintendo-style swap, and untouched braces', () => {
  const text = '{confirm} ok, {back} back, {west} bksp, {north} word, {menu} menu, {view}, {l1}/{r1} {l2}/{r2} {l3}/{r3} on {pad}';
  assert.equal(formatGlyphs(text, { family: 'playstation' }), 'X ok, O back, SQ bksp, TRI word, OPTIONS menu, SHARE, L1/R1 L2/R2 L3/R3 on PlayStation controller');
  assert.equal(formatGlyphs(text, { family: 'xbox' }), 'A ok, B back, X bksp, Y word, MENU menu, VIEW, LB/RB LT/RT LS/RS on Xbox controller');
  assert.equal(formatGlyphs(text, { family: 'nintendo' }), 'B ok, A back, Y bksp, X word, + menu, -, L/R ZL/ZR LS/RS on Nintendo controller');
  assert.equal(formatGlyphs('{confirm} / {back}', { family: 'nintendo', swap: true }), 'A / B');
  assert.equal(glyph('south', { family: 'standard' }), 'A');
  assert.equal(formatGlyphs('{agent} {CONFIRM} {} {menu', { family: 'xbox' }), '{agent} {CONFIRM} {} {menu');
  for (const family of families) assert.ok(/^[\x20-\x7e]*$/.test(formatGlyphs(text, { family })), family);
  assert.equal(familyFromName('Wireless Controller'), 'playstation'); assert.equal(familyFromName('DualSense Wireless Controller'), 'playstation');
  assert.equal(familyFromName('Xbox Wireless Controller'), 'xbox'); assert.equal(familyFromName('Pro Controller'), 'nintendo'); assert.equal(familyFromName('MOMENTUM 4'), undefined);
  assert.match(pairingHints.playstation, /SHARE \+ PS.*CREATE \+ PS/); assert.match(pairingHints.xbox, /pair button/); assert.match(pairingHints.nintendo, /sync/);
});

test('A3 visible strings name buttons through placeholders, not literal PlayStation names', () => {
  // Strings in sources other than the name table and documented exceptions must not hard-code PlayStation buttons.
  const allowed = new Set(['glyphs.ts', 'protocol.ts']);
  const exceptions = [/DUALSHOCK 4 \/ PREVIEW/, /PlayStation \/ Xbox names/, /OPTIONS \/ MENU/, /L2 \/ LT/, /SQ \/ X/, /TRI \/ Y/, /L3 \/ LS/, /R2 \/ RT, R3 \/ RS/, /\(TRI\)|\(SQ\)/];
  const literal = /'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"/g;
  const offenders = [];
  for (const file of readdirSync('src').filter(name => name.endsWith('.ts') && !allowed.has(name))) {
    const source = readFileSync(`src/${file}`, 'utf8').split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    for (const [text] of source.matchAll(literal)) {
      if (exceptions.some(pattern => pattern.test(text))) continue;
      if (/\b(?:Options|OPTIONS|SHARE|DUALSHOCK|DualShock|Triangle|Square)\b|\bL[123]\b|\bR[123]\b|\b[XO] (?:confirm|back|cancel|Enter|Escape|choose|keep|to claim)/.test(text)) offenders.push(`${file}: ${text.slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('A4 Nintendo-style confirm: east confirms in menus and the Agent, names follow', async () => {
  // A saved Nintendo controller that prefers east (A) as confirm.
  const { AgentGamepad } = await import('../dist/agent-gamepad.js');
  let listener; const feed = { start: async () => {}, stop: async () => {}, snapshot: () => [{ type: 'connected', device: 1, name: 'Pro Controller', connection: 'wireless', family: 'nintendo', serial: target.address }], subscribe: fn => { listener = fn; return () => {}; } };
  const gamepad = new AgentGamepad({ ...target, family: 'nintendo', confirm: 'east' }, { factory: () => feed, automaticHandoff: true });
  const bytes = [], statuses = []; gamepad.subscribe(b => bytes.push(b.toString()), s => statuses.push(s), () => {});
  await gamepad.start(new AbortController().signal); await new Promise(r => setTimeout(r, 275));
  const press = button => { listener({ type: 'button', device: 1, button, down: true }); listener({ type: 'button', device: 1, button, down: false }); };
  press('east'); press('south');
  assert.deepEqual(bytes, ['\r', '\x1b'], 'east did not confirm with the Nintendo-style setting');
  assert.deepEqual(gamepad.glyphs(), { family: 'nintendo', swap: true }); assert.match(statuses.at(-1), /ACTIVE \/ \+ to pause/);
  await gamepad.stop();
  // Menus swap the same way.
  let menuListener; const menuFeed = { start: async () => {}, stop: async () => {}, snapshot: () => [{ type: 'connected', device: 1, name: 'Pro Controller', connection: 'wireless', family: 'nintendo', serial: target.address }], subscribe: fn => { menuListener = fn; return () => {}; } };
  const menus = new GamepadMenus(() => menuFeed), actions = [];
  menus.subscribeAction(action => actions.push(action));
  await menus.activate({ ...target, family: 'nintendo', confirm: 'east' }, new AbortController().signal, true);
  await new Promise(r => setTimeout(r, 300));
  menuListener({ type: 'button', device: 1, button: 'east', down: true }); menuListener({ type: 'button', device: 1, button: 'south', down: true });
  assert.deepEqual(actions, ['confirm', 'cancel']); assert.match(menus.statusText, /A confirm, B back/);
  await menus.stop();
});

test('A4 configuration: family and confirm are validated and kept', () => {
  const base = { version: 2, controller: { transport: 'bluetooth', inputVerified: true }, agent: null, profile: 'terminal-basic', voice: null };
  assert.deepEqual(validateConfig({ ...base, controller: { ...base.controller, family: 'xbox', confirm: 'east' } }).controller, { transport: 'bluetooth', inputVerified: true, family: 'xbox', confirm: 'east' });
  assert.equal(validateConfig(base).controller.family, undefined);
  for (const controller of [{ family: 'sega' }, { confirm: 'north' }]) assert.throws(() => validateConfig({ ...base, controller: { ...base.controller, ...controller } }));
});

test('A5 controller map and status legend follow the family', () => {
  const map = family => renderControllerMap({ agent: 'claude', voice: true, family }, mapWidth, asciiCaps).join('\n');
  assert.match(map('playstation'), /TOUCHPAD/); assert.match(map('playstation'), /\(TRI\)/);
  for (const family of ['xbox', 'nintendo', 'standard']) { assert.match(map(family), /HOME/); assert.doesNotMatch(map(family), /TOUCHPAD|\(TRI\)/); }
  assert.match(map('xbox'), /\[LT\] Hold to dictate/); assert.match(map('xbox'), /\(A\)\s+Enter \/ send/);
  assert.match(renderControllerMap({ agent: 'claude', voice: true, family: 'nintendo', swap: true }, mapWidth, asciiCaps).join('\n'), /\(A\)\s+Enter \/ send/);
  for (const family of families) {
    const lines = renderControllerMap({ agent: 'claude', voice: true, family }, mapWidth, asciiCaps);
    const frame = lines.slice(3, lines.findIndex(line => line.includes('L STICK  ')) + 1);
    assert.equal(new Set(frame.map(line => line.length)).size, 1, `${family} frame does not close`);
  }
  assert.match(renderPanel('ACTIVE / x', asciiCaps, 2, undefined, { family: 'xbox' })[1], /\[A\] ENTER {2}\[B\] ESC {2}\[LB\] TAB {2}\[RB\] SHIFT\+TAB {2}\[MENU\] MENU/);
});

test('A5 setup: pairing hints for every family and the Nintendo confirm question', async () => {
  const run = async (family, choices) => {
    const output = [];
    const io = { banner: t => output.push(t), say: t => output.push(t), ask: async () => '', choose: async (label, options) => { output.push(label); const value = choices.shift(); assert.ok(options.some(o => o.value === value), `${value}: ${label}`); return value; } };
    const device = { v: 1, seq: 1, time: 1, type: 'connected', device: 1, name: 'Pad', connection: 'wireless', serial: 'aa:bb:cc:dd:ee:ff', ...(family ? { family } : {}) };
    const services = {
      bluetooth: { list: async scan => scan ? [{ address: 'aa:bb:cc:dd:ee:ff', name: 'Pro Controller', paired: false, connected: false }] : [], pair: async () => ({ address: 'aa:bb:cc:dd:ee:ff', name: 'Pro Controller', paired: true, connected: false }), connect: async () => ({ address: 'aa:bb:cc:dd:ee:ff', name: 'Pro Controller', paired: true, connected: true }) },
      probe: () => ({ start: async () => {}, devices: async () => [device], press: async () => 'south', stop: async () => {} }),
      agents: async () => [], resolve: async () => null, save: async () => {},
    };
    const config = await setup(io, services, new AbortController().signal);
    return { config, text: output.join('\n') };
  };
  let r = await run('nintendo', ['bluetooth', 'scan', '0', 'connect', 'test', '1', 'east', 'later', 'terminal-basic', 'save']);
  assert.match(r.text, /PAIRING {2}PS4: hold SHARE \+ PS/); assert.match(r.text, /PAIRING {2}Xbox: hold the pair button/); assert.match(r.text, /PAIRING {2}Switch Pro: hold the small sync button/);
  assert.match(r.text, /Confirm button on this Nintendo controller/);
  assert.deepEqual([r.config.controller.family, r.config.controller.confirm], ['nintendo', 'east']);
  r = await run('xbox', ['bluetooth', 'scan', '0', 'connect', 'test', '1', 'later', 'terminal-basic', 'save']);
  assert.doesNotMatch(r.text, /Confirm button on this Nintendo/); assert.deepEqual([r.config.controller.family, r.config.controller.confirm], ['xbox', undefined]);
});
