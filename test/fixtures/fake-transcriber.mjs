// Fake command transcriber: behavior chosen by the first argument. Never transcription evidence.
import { existsSync, appendFileSync } from 'node:fs';
const [mode, ...rest] = process.argv.slice(2);
if (process.env.PADCODE_TRANSCRIBER_LOG) appendFileSync(process.env.PADCODE_TRANSCRIBER_LOG, JSON.stringify(rest) + '\n');
const audio = rest.find(arg => arg.endsWith('.wav'));
if (audio && !existsSync(audio)) { process.stderr.write('missing audio\n'); process.exit(4); }
const say = text => process.stdout.write(text);
switch (mode) {
  case 'ok': say('  帮我修复登录页面的 bug，然后运行测试。\n'); break;
  case 'unicode': say('naïve café 日本語 🎮 한국어\n'); break;
  case 'controls': say('ls\x1b[2J\x1b]0;evil\x07 \x1b[200~paste\x1b[201~ ok\r\nline2\t\ttab\u0085\x00\n\n\n\nend'); break;
  case 'short': say('1\n'); break;
  case 'mixed': say('fix 🎮 登录\n第二行 é\n'); break;
  case 'empty': say('\n  \n'); break;
  case 'oversize': say('x'.repeat(70 * 1024)); break;
  case 'invalid': process.stdout.write(Buffer.from([0x66, 0xff, 0xfe, 0x67])); break;
  case 'fail': process.stderr.write('model \x1b[31mnot\x1b[0m found\nsecond line'); process.exit(3);
  case 'sleep': setTimeout(() => say('late'), 60000); break;
  case 'args': say(JSON.stringify(rest)); break;
  default: process.exit(9);
}
