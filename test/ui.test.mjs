import test from 'node:test';
import assert from 'node:assert/strict';
import { safeLabel, safeText } from '../dist/ui.js';
test('hostile labels', () => {
  assert.equal(safeLabel('\x1b\n\r\u009béλ'), '??????');
  // Transcripts and device names keep Unicode but lose controls, bidi overrides and lone surrogates.
  assert.equal(safeText('안녕 é🎮 Studio Displayマイク'), '안녕 é🎮 Studio Displayマイク');
  assert.equal(safeText('a\x1b[2Jb\u202eevil\u0085\ud800c'), 'a [2Jb evil ?c');
});
