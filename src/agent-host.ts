// Internal PTY session leader. Retain the slave until the parent acknowledges drain.
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
const [socketPath, command, ...args] = process.argv.slice(2);
if (!socketPath || !command) throw new Error('Agent host requires its private control socket and executable.');
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});
const control = connect(socketPath);
let code: number | undefined, message = '';
control.on('connect', () => {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env });
  child.on('error', error => process.stderr.write(`Agent launch failed: ${error.message}\n`));
  child.on('close', (exitCode, signal) => {
    code = signal ? 128 + constants.signals[signal] : exitCode !== null && exitCode >= 0 ? exitCode : 1;
    control.write('exited\n');
  });
});
control.on('data', data => {
  message += data.toString();
  if (message === 'drained\n' && code !== undefined) { control.end(); process.exitCode = code; }
  else if (message.length > 32) process.exit(1);
});
control.on('error', () => process.exit(1));
control.on('close', () => {
  if (message !== 'drained\n' || code === undefined) process.exit(1);
});
