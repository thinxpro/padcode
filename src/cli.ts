#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { session } from './session.js';
import { colorEnabled, help, safeLabel } from './ui.js';
import { runConfiguredAgent } from './agent-session.js';
import { onboarding } from './onboarding.js';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if ((!args.length && (!process.stdin.isTTY || !process.stdout.isTTY)) || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
    process.stdout.write(help(colorEnabled(process.env, Boolean(process.stdout.isTTY))));
    return 0;
  }
  if (!args.length || (args.length === 1 && args[0] === 'config')) return onboarding(args[0] === 'config');
  if (args.length === 1 && args[0] === 'run') return runConfiguredAgent();
  if (args.length === 1 && args[0] === '--version') {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if ((args[0] === 'demo' && args.length === 1) || (args[0] === 'controllers' && (args.length === 1 || (args.length === 2 && args[1] === '--json')))) {
    return session({ demo: args[0] === 'demo', json: args[1] === '--json' });
  }
  process.stderr.write('Unknown command or option. Run padcode --help.\n');
  return 2;
}
try { process.exitCode = await main(); }
catch (error) {
  process.stderr.write(`Padcode: ${safeLabel((error as Error).message)}\n`);
  process.exitCode = 1;
}
