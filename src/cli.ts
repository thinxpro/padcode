#!/usr/bin/env node
import { session } from './session.js';
import { help, safeLabel } from './ui.js';
import { detectCaps } from './tui/index.js';
import { version } from './version.js';
import { runConfiguredAgent } from './agent-session.js';
import { onboarding } from './onboarding.js';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if ((!args.length && (!process.stdin.isTTY || !process.stdout.isTTY)) || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
    const caps = detectCaps(process.env, process.stdout);
    // Piped help stays plain ASCII for scripts.
    process.stdout.write(help(process.stdout.isTTY ? caps : { ...caps, unicode: false }));
    return 0;
  }
  if (!args.length || (args.length === 1 && args[0] === 'config')) return onboarding(args[0] === 'config');
  if (args.length === 1 && args[0] === 'run') return runConfiguredAgent();
  if (args.length === 1 && args[0] === '--version') {
    process.stdout.write(`${version()}\n`);
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
