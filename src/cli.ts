#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { session } from './session.js';
import { colorEnabled, help } from './ui.js';
const args = process.argv.slice(2);
if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
  process.stdout.write(help(colorEnabled(process.env, Boolean(process.stdout.isTTY))));
} else if (args.length === 1 && args[0] === '--version') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  process.stdout.write(`${pkg.version}\n`);
} else if ((args[0] === 'demo' && args.length === 1) || (args[0] === 'controllers' && (args.length === 1 || (args.length === 2 && args[1] === '--json')))) {
  process.exitCode = await session({ demo: args[0] === 'demo', json: args[1] === '--json' });
} else {
  process.stderr.write('Unknown command or option. Run padcode --help.\n'); process.exitCode = 2;
}
