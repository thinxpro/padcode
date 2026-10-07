import { session } from '../../dist/session.js';
import { resolve } from 'node:path';
const mode = process.argv[2];
process.exitCode = await session({
  demo: mode === 'demo', json: process.argv[3] !== 'tty',
  helper: mode === 'missing' ? '/padcode-test-missing-helper' : process.execPath,
  helperArgs: [resolve('test/fixtures/helper.mjs'), mode],
});
