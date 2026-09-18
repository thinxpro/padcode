import { configPath, discoverAgents, loadConfig, resolveExecutable, saveConfig, type Config } from './config.js';
import { NativeBluetooth, type BluetoothPort } from './bluetooth.js';
import { identityMatch, type ProbePort } from './probe.js';
import { TerminalPrompt, type PromptPort } from './prompt.js';
import { session } from './session.js';
import { GamepadMenus } from './menu-controller.js';

export interface SetupServices {
  activateMenus?: (controller: Config['controller']) => Promise<void>;
  bluetooth: BluetoothPort;
  probe: () => ProbePort;
  agents: typeof discoverAgents;
  resolve: typeof resolveExecutable;
  save: (config: Config) => Promise<void>;
}
const cleanName = (text: string) => text.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512);

async function linkController(io: PromptPort, services: SetupServices, signal: AbortSignal, initial?: Config): Promise<Config['controller']> {
  io.banner('MISSION 01 / LINK CONTROLLER');
  let mode = await io.choose('Connection route', [
    { label: 'Bluetooth / recommended', value: 'bluetooth' },
    { label: 'USB cable', value: 'usb' },
    { label: 'Configure Bluetooth later', value: 'later' },
  ], initial?.controller.transport === 'usb' ? 1 : 0);
  for (;;) {
    signal.throwIfAborted();
    if (mode === 'later') return { transport: 'bluetooth', inputVerified: false };
    if (mode === 'usb') {
      io.say('Connect your controller using a USB data cable. Input will be tested next.');
      return { transport: 'usb', inputVerified: false };
    }
    try {
      io.say('Checking Bluetooth. macOS may ask for Bluetooth permission for padcode-bluetooth.');
      let devices = await services.bluetooth.list(false, signal);
      for (;;) {
        const selected = await io.choose('Select a device, or discover a new controller', [
          { label: 'Scan nearby / hold SHARE + PS until the light flashes', value: 'scan' },
          ...devices.map((device, i) => ({ label: `${cleanName(device.name)} / ${device.address} / ${device.connected ? 'connected' : device.paired ? 'paired' : 'new'}`, value: String(i) })),
          { label: 'Use USB instead', value: 'usb' },
          { label: 'Configure Bluetooth later', value: 'later' },
        ]);
        if (selected === 'scan') {
          io.say('SCANNING... keep SHARE + PS pairing mode active (20-second scan; up to 35 seconds including macOS initialization).');
          devices = await services.bluetooth.list(true, signal);
          if (services.bluetooth.scanWarning) io.say(services.bluetooth.scanWarning);
          else io.say(devices.length ? `Discovery complete: ${devices.length} nearby device(s). Select your controller.` : 'No nearby devices found. Keep SHARE + PS pairing active, wait 15 seconds, then scan again.');
          continue;
        }
        if (selected === 'usb' || selected === 'later') { mode = selected; break; }
        let device = devices[Number(selected)];
        if (!device) throw new Error('Selected Bluetooth device is no longer available.');
        if (await io.choose(`Connect ${cleanName(device.name)} (${device.address})?`, [
          { label: 'Pair/connect this device', value: 'connect' }, { label: 'Back to device list', value: 'back' },
        ]) === 'back') continue;
        if (!device.paired) { io.say('PAIRING...'); device = await services.bluetooth.pair(device.address, signal); }
        if (!device.connected) { io.say('CONNECTING...'); device = await services.bluetooth.connect(device.address, signal); }
        io.say('Bluetooth connected. Controller input still needs a separate check.');
        return { transport: 'bluetooth', name: cleanName(device.name), address: device.address, inputVerified: false };
      }
    } catch (error) {
      signal.throwIfAborted();
      if ((error as Error).message === 'Setup cancelled.') throw error;
      io.say(`LINK NOT READY: ${(error as Error).message}`);
      mode = await io.choose('Recovery', [
        { label: 'Retry Bluetooth', value: 'bluetooth' }, { label: 'Use USB', value: 'usb' }, { label: 'Configure Bluetooth later', value: 'later' },
      ]);
    }
  }
}

async function verifyInput(io: PromptPort, services: SetupServices, controller: Config['controller'], signal: AbortSignal): Promise<Config['controller']> {
  io.banner('MISSION 02 / INPUT CHECK');
  for (;;) {
    const action = await io.choose('Pairing and input readiness are checked separately', [
      { label: 'Test a controller button now', value: 'test' }, { label: 'Skip for now / mark input unverified', value: 'skip' },
    ], controller.transport === 'bluetooth' && !controller.address ? 1 : 0);
    if (action === 'skip') { io.say('Input remains UNVERIFIED.'); return controller; }
    const probe = services.probe();
    try {
      io.say('Waiting for controller input devices...');
      await probe.start(signal);
      const devices = (await probe.devices(signal)).filter(device => identityMatch(device, controller.transport, controller.address) !== 'mismatch');
      if (!devices.length) throw new Error('No input device matches the selected transport/device. Check the connection and retry.');
      const selected = await io.choose('Choose the physical controller you will press', devices.map(device => ({
        value: String(device.device), label: `${cleanName(device.name)} / ${device.connection ?? 'unknown'} / ${identityMatch(device, controller.transport, controller.address) === 'match' ? 'identity matched' : 'confirm device manually'}`,
      })));
      const device = devices.find(item => item.device === Number(selected));
      if (!device) throw new Error('Invalid input device.');
      io.say('PRESS ANY CONTROLLER BUTTON NOW (20 seconds)...');
      const button = await probe.press(device.device, signal);
      io.say(`INPUT CHECK PASSED / ${button}`);
      return { ...controller, name: controller.name ?? cleanName(device.name), inputVerified: true };
    } catch (error) {
      signal.throwIfAborted();
      if ((error as Error).message === 'Setup cancelled.') throw error;
      io.say(`INPUT NOT VERIFIED: ${(error as Error).message}`);
    } finally { await probe.stop(); }
  }
}

async function chooseAgent(io: PromptPort, services: SetupServices, initial?: Config): Promise<Config['agent']> {
  io.banner('MISSION 03 / CHOOSE YOUR AGENT');
  io.say('Use your own installed Agent and account. Discovery does not launch any program.');
  const found = await services.agents();
  for (;;) {
    const selection = await io.choose('Agent command', [
      ...(initial?.agent ? [{ label: `Keep ${initial.agent.command}`, value: 'keep' }] : []),
      ...found.map((agent, index) => ({ label: `${agent.label} / ${agent.command}`, value: String(index) })),
      { label: 'Custom executable / command', value: 'custom' }, { label: 'Choose an Agent later', value: 'later' },
    ]);
    if (selection === 'later') return null;
    const candidate = selection === 'keep' ? initial!.agent!.command : selection === 'custom' ? await io.ask('Executable path or command (no arguments):') : found[Number(selection)]?.command ?? '';
    const command = await services.resolve(candidate);
    if (!command) { io.say('Executable not found. Install/login with your preferred Agent separately, or choose later.'); continue; }
    if (selection === 'keep') return { command, args: [...initial!.agent!.args] };
    const args: string[] = [];
    if (selection === 'custom') {
      io.say('Arguments are literal values, never a shell script. Enter one per line; empty finishes.');
      for (;;) {
        const argument = await io.ask(`Argument ${args.length + 1} (Enter to finish):`);
        if (!argument) break;
        if (/[\x00-\x1f\x7f]/.test(argument) || argument.length > 4096) { io.say('Argument is too long or contains control characters.'); continue; }
        args.push(argument);
        if (args.length === 64) { io.say('Maximum of 64 arguments reached.'); break; }
      }
    }
    return { command, args };
  }
}

export async function setup(io: PromptPort, services: SetupServices, signal: AbortSignal, initial?: Config): Promise<Config | null> {
  const linked = await linkController(io, services, signal, initial);
  if (linked.address || linked.transport === 'usb') await services.activateMenus?.(linked);
  const controller = await verifyInput(io, services, linked, signal);
  const agent = await chooseAgent(io, services, initial);
  io.banner('MISSION 04 / LOADOUT');
  await io.choose('Key profile', [{ label: 'Terminal basic / D-pad arrows, X Enter, O Escape, L1 Tab / R1 Shift+Tab', value: 'terminal-basic' }]);
  const config: Config = { version: 1, controller, agent, profile: 'terminal-basic' };
  io.banner('MISSION 05 / SAVE POINT');
  io.say(`LINK    ${controller.transport.toUpperCase()} / ${controller.name ?? 'not selected'}`);
  io.say(`INPUT   ${controller.inputVerified ? 'verified during this setup' : 'UNVERIFIED'}`);
  io.say(`AGENT   ${agent?.command ?? 'not selected'}`);
  if (agent?.args.length) io.say(`ARGS    ${JSON.stringify(agent.args)}`);
  io.say('PROFILE terminal-basic');
  io.say('This build saves your Agent loadout. Agent sessions arrive in the separate PTY stage.');
  if (await io.choose('Save this configuration?', [{ label: 'Save locally', value: 'save' }, { label: 'Cancel / keep previous configuration', value: 'cancel' }]) === 'cancel') return null;
  signal.throwIfAborted();
  await services.save(config);
  io.say('SAVE COMPLETE');
  return config;
}

export async function onboarding(edit = false): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stderr.write('Setup requires an interactive terminal. Run padcode --help for commands.\n'); return 2; }
  const controller = new AbortController();
  let exitCode = 130;
  const cancel = () => controller.abort();
  const terminate = () => { exitCode = 143; controller.abort(); };
  process.on('SIGINT', cancel); process.on('SIGTERM', terminate);
  const menus = new GamepadMenus();
  const io = new TerminalPrompt(controller.signal, cancel, menus);
  let action = 'quit';
  try {
    let config: Config | null;
    try { config = await loadConfig(); }
    catch (error) {
      io.say((error as Error).message);
      if (await io.choose('Existing file will only be replaced after a successful save', [{ label: 'Reconfigure', value: 'reset' }, { label: 'Exit and preserve file', value: 'exit' }]) === 'exit') return 1;
      config = null; edit = true;
    }
    if (config && (config.controller.address || config.controller.transport === 'usb')) await menus.activate(config.controller, controller.signal);
    if (!config || edit) {
      config = await setup(io, {
        bluetooth: new NativeBluetooth(), probe: () => menus.probe(), activateMenus: target => menus.activate(target, controller.signal), agents: discoverAgents, resolve: resolveExecutable, save: saveConfig,
      }, controller.signal, config ?? undefined);
      if (!config) { io.say('No configuration changes saved.'); return 0; }
      io.say(`Configuration: ${configPath()}`);
    }
    io.banner('PLAYER HUB');
    io.say(`LINK ${config.controller.transport.toUpperCase()} / ${config.controller.name ?? 'not selected'}`);
    io.say(`INPUT ${config.controller.inputVerified ? 'last setup check passed (not a live connection status)' : 'UNVERIFIED'}`);
    io.say(`AGENT ${config.agent?.command ?? 'not selected'}`);
    io.say('Agent sessions are not available in this developer build.');
    action = await io.choose('Ready when you are', [
      { label: 'Controller lab / test live input', value: 'controllers' },
      { label: 'Edit configuration', value: 'config' },
      { label: 'Preview arcade dashboard', value: 'demo' },
      { label: 'Exit', value: 'quit' },
    ]);
  } catch (error) {
    if (controller.signal.aborted) { io.say('Setup cancelled. No pending configuration changes saved.'); return exitCode; }
    io.say(`SETUP STOPPED: ${(error as Error).message}`); return (error as Error).message === 'Setup cancelled.' ? 0 : 1;
  } finally {
    await menus.stop(); io.close(); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', terminate);
  }
  if (action === 'config') return onboarding(true);
  if (action === 'controllers' || action === 'demo') return session({ demo: action === 'demo', json: false });
  return 0;
}
