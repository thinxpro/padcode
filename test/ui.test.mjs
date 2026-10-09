import test from 'node:test';
import assert from 'node:assert/strict';
import { safeLabel, safeText, colorEnabled } from '../dist/ui.js';
test('NO_COLOR, dumb terminal, non-TTY and hostile labels', () => {
  assert.equal(colorEnabled({}, true), true);
  for (const env of [{ NO_COLOR: '' }, { TERM: 'dumb' }]) assert.equal(colorEnabled(env, true), false);
  assert.equal(colorEnabled({}, false), false);
  assert.equal(safeLabel('\x1b\n\r\u009béλ'), '??????');
  // Transcripts and device names keep Unicode but lose controls, bidi overrides and lone surrogates.
  assert.equal(safeText('帮我 é🎮 Studio Display麦克风'), '帮我 é🎮 Studio Display麦克风');
  assert.equal(safeText('a\x1b[2Jb\u202eevil\u0085\ud800c'), 'a [2Jb evil ?c');
});
