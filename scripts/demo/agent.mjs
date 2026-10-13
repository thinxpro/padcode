#!/usr/bin/env node
// Stand-in Agent for the scripted demo: a neutral prompt with canned replies. It runs nothing and
// imitates no real product. Its state goes to the file named by the first argument so the timeline can wait on it.
import { writeFileSync } from 'node:fs';

const statePath = process.argv[2];
const color = process.env.NO_COLOR === undefined;
const paint = (code, text) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
const dim = text => paint('2', text), bold = text => paint('1', text), accent = text => paint('36', text);
const green = text => paint('32', text), red = text => paint('31', text), yellow = text => paint('33', text);
const out = text => process.stdout.write(text);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const state = { phase: 'starting', input: '', submitted: [], answers: [] };
const save = () => { if (statePath) writeFileSync(statePath, JSON.stringify(state)); };
let cursor = 0, choice = 0, busy = false;

function prompt() {
  const before = state.input.slice(0, cursor), after = state.input.slice(cursor);
  out(`\r\x1b[2K${accent('›')} ${before}\x1b7${after}\x1b8`);
}
function approval() {
  const options = ['Yes, apply it', 'No, keep chatting'];
  out(`\x1b[${options.length}A`);
  options.forEach((label, index) => out(`\r\x1b[2K  ${index === choice ? accent(`❯ ${index + 1}. ${label}`) : dim(`  ${index + 1}. ${label}`)}\r\n`));
}
async function step(text, ms = 450) {
  out(`\r\x1b[2K${yellow('◌')} ${text}`); await sleep(ms);
  out(`\r\x1b[2K${green('●')} ${text}\r\n`);
}
async function reply(text) {
  busy = true; state.phase = 'working'; save();
  out(`\r\x1b[2K${dim(`› ${text}`)}\r\n\r\n`);
  if (text.startsWith('/test')) {
    await step('Running npm test', 900);
    out(`  ${green('24 passed')} ${dim('· 0 failed · 1.8s')}\r\n\r\n`);
  } else {
    await step('Reading src/settings/SettingsPage.tsx');
    await step('Reading src/theme.ts');
    out(`\r\n${bold('Plan')}  Add a theme switch to Settings and remember the choice.\r\n\r\n`);
    out(`  ${dim('src/settings/SettingsPage.tsx')}\r\n`);
    out(`  ${dim('41')}   <Section title="Appearance">\r\n`);
    out(`  ${dim('42')} ${red('-   <p>Light theme only</p>')}\r\n`);
    out(`  ${dim('42')} ${green('+   <Toggle label="Dark mode" checked={dark}')}\r\n`);
    out(`  ${dim('43')} ${green('+     onChange={setDark} />')}\r\n`);
    out(`  ${dim('44')}   </Section>\r\n\r\n`);
    out(`${bold('Apply this edit?')}\r\n\r\n\r\n`);
    choice = 0; approval();
    state.phase = 'approval'; save(); busy = false;
    return;
  }
  finish();
}
async function decide() {
  busy = true; state.answers.push(choice === 0 ? 'yes' : 'no'); state.phase = 'working'; save();
  out('\r\n');
  if (choice === 0) {
    await step('Edited src/settings/SettingsPage.tsx (+2 -1)');
    await step('Saved the theme in localStorage', 350);
    out(`\r\nDark mode is ready. Try ${accent('/test')} to run the suite.\r\n\r\n`);
  } else out(`${dim('Edit skipped.')}\r\n\r\n`);
  finish();
}
function finish() { state.input = ''; cursor = 0; busy = false; state.phase = 'ready'; save(); prompt(); }

function key(sequence) {
  if (busy) return;
  if (state.phase === 'approval') {
    if (sequence === '\x1b[A' || sequence === '\x1b[B') { choice = 1 - choice; approval(); }
    else if (sequence === '\r') void decide();
    return;
  }
  if (sequence === '\r') { const text = state.input.trim(); if (text) { state.submitted.push(text); void reply(text); } return; }
  if (sequence === '\x7f' || sequence === '\b') { if (cursor) { state.input = state.input.slice(0, cursor - 1) + state.input.slice(cursor); cursor--; } }
  else if (sequence === '\x1b[D') cursor = Math.max(0, cursor - 1);
  else if (sequence === '\x1b[C') cursor = Math.min(state.input.length, cursor + 1);
  else if (sequence === '\x1b' || sequence === '\x15') { state.input = ''; cursor = 0; }
  else if (/^[^\x00-\x1f\x7f]+$/u.test(sequence)) { state.input = state.input.slice(0, cursor) + sequence + state.input.slice(cursor); cursor += sequence.length; }
  else return;
  save(); prompt();
}
// Splits a chunk into escape sequences and single characters; bracketed paste markers are dropped.
function keys(chunk) {
  const text = chunk.toString('utf8').replace(/\x1b\[20[01]~/g, '');
  const found = text.match(/\x1b\[[0-9;]*[A-Za-z~]|\x1b.|[\s\S]/gu) ?? [];
  let printable = '';
  for (const part of found) {
    if (/^[^\x00-\x1f\x7f]$/u.test(part)) { printable += part; continue; }
    if (printable) { key(printable); printable = ''; }
    key(part);
  }
  if (printable) key(printable);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
out('\x1b[?2004h');
const quit = () => { state.phase = 'exited'; save(); process.exit(0); };
for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.on(signal, quit);
out(`\r\n ${accent('◆')} ${bold('demo-agent')}  ${dim('stand-in Agent for the Padcode demo · runs nothing')}\r\n`);
out(`   ${dim(process.cwd().replace(/^.*\//, '~/'))}\r\n\r\n`);
finish();
process.stdin.on('data', keys);
process.stdin.on('end', quit);
