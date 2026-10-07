import { resolve } from 'node:path';
import { onboarding } from '../../dist/onboarding.js';
import { GamepadMenus } from '../../dist/menu-controller.js';
import { ControllerProbe } from '../../dist/probe.js';
// Player Hub with the real onboarding flow and a file-driven virtual controller.
const menus = new GamepadMenus(() => new ControllerProbe(process.execPath, [resolve('test/fixtures/menu-helper.mjs'), process.argv[2]]));
process.exitCode = await onboarding(false, menus);
