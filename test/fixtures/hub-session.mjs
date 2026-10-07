import { resolve } from 'node:path';
import { onboarding } from '../../dist/onboarding.js';
import { GamepadMenus } from '../../dist/menu-controller.js';
import { ControllerProbe } from '../../dist/probe.js';
import { NativeAudio } from '../../dist/audio.js';
// Player Hub with the real onboarding flow and a file-driven virtual controller.
const menus = new GamepadMenus(() => new ControllerProbe(process.execPath, [resolve('test/fixtures/menu-helper.mjs'), process.argv[2]]));
// Fake microphone helper; never microphone evidence.
const audio = new NativeAudio({ command: process.execPath, args: [resolve('test/fixtures/audio-helper.mjs')], player: resolve('test/fixtures/fake-player.sh'), supported: true });
process.exitCode = await onboarding(false, menus, { helper: process.execPath, helperArgs: [resolve('test/fixtures/menu-helper.mjs'), process.argv[2]] }, audio);
