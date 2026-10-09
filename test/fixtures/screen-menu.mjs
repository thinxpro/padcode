// Full-screen menu under a real PTY. Fake gamepad actions and statuses arrive on the FEED_FD pipe, one per line.
import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';
import { createInterface } from 'node:readline';
import { TerminalPrompt } from '../../dist/prompt.js';

const events = new EventEmitter();
const gamepad = {
  statusText: 'GAMEPAD MENUS / start',
  glyphs: () => ({ family: 'playstation' }),
  subscribeAction(listener) { events.on('action', listener); return () => events.off('action', listener); },
  subscribeStatus(listener) { events.on('status', listener); return () => events.off('status', listener); },
};
// A socket, not a file stream: a blocking pipe read in the thread pool would keep the process from exiting.
createInterface({ input: new Socket({ fd: Number(process.env.FEED_FD), readable: true, writable: false }) }).on('line', line => line.startsWith('status:') ? events.emit('status', line.slice(7)) : events.emit('action', line));
const controller = new AbortController();
const io = new TerminalPrompt(controller.signal, () => controller.abort(), gamepad);
const choices = ['one', 'two', 'three', 'quit'].map(value => ({ label: value.toUpperCase(), value }));
let frames = 0;
try {
  const value = await io.screen(choices, view => {
    frames++;
    return [`FRAME ${frames} SEL ${view.selected + 1} SHINE ${view.shine === undefined ? '-' : 'on'} STATUS ${view.status} FLASH ${view.flash || '-'} W ${view.caps.width} END`];
  }, { intro: Number(process.env.INTRO ?? 0) });
  process.stdout.write(`\nRESULT ${value}${controller.signal.aborted ? ' ABORTED' : ''}\n`);
} catch (error) { process.stdout.write(`\nERROR ${error.message}${controller.signal.aborted ? ' ABORTED' : ''}\n`); }
process.exit(0);
