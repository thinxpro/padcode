import { confirmAgent, launchConfigured } from './agent-session.js';
import { chooseDisplay, type Display } from './tmux.js';
import { configPath, discoverAgents, loadConfig, resolveExecutable, saveConfig, type Config } from './config.js';
import { NativeBluetooth, type BluetoothPort } from './bluetooth.js';
import { identityMatch, type ProbePort } from './probe.js';
import { TerminalPrompt, type PromptPort } from './prompt.js';
import { session } from './session.js';
import { GamepadMenus, type MenuFeed } from './menu-controller.js';
import { mergeDeviceChoices, scanDeviceChoices } from './bluetooth-picker.js';
import { NativeAudio, type AudioPort } from './audio.js';
import { rm } from 'node:fs/promises';
import { voiceDirectory } from './voice-session.js';
import { join } from 'node:path';

export interface SetupServices {
  activateMenus?: (controller: Config['controller']) => Promise<void>;
  bluetooth: BluetoothPort;
  probe: () => ProbePort;
  agents: typeof discoverAgents;
  resolve: typeof resolveExecutable;
  save: (config: Config) => Promise<void>;
  audio?: AudioPort;
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
      let devices = mergeDeviceChoices(await services.bluetooth.list(false, signal), []);
      for (;;) {
        const selected = await io.choose('Select a device, or discover a new controller', [
          { label: 'Scan nearby / hold SHARE + PS until the light flashes', value: 'scan' },
          ...devices.map((device, i) => ({ label: `${cleanName(device.name)} / ${device.address} / ${device.cached ? 'status unknown / cached' : device.connected ? 'connected' : device.paired ? 'paired' : 'new'} / ${device.source}`, value: String(i) })),
          { label: 'Use USB instead', value: 'usb' },
          { label: 'Configure Bluetooth later', value: 'later' },
        ]);
        if (selected === 'scan') {
          io.say('SCANNING... keep SHARE + PS pairing mode active (20-second scan; up to 35 seconds including macOS initialization).');
          const result = await scanDeviceChoices(services.bluetooth, devices, signal, () => io.say('Refreshing paired/connected devices...'));
          devices = result.devices;
          for (const warning of result.warnings) io.say(warning);
          if (result.discovered !== undefined) io.say(result.discovered
            ? `Nearby results: ${result.discovered} device(s). Known devices are also listed below.`
            : 'No nearby devices found. Known devices are still listed below; select a connected controller directly.');
          continue;
        }
        if (selected === 'usb' || selected === 'later') { mode = selected; break; }
        let device: import('./bluetooth.js').BluetoothDevice | undefined = devices[Number(selected)];
        if (!device) throw new Error('Selected Bluetooth device is no longer available.');
        if (await io.choose(`Connect ${cleanName(device.name)} (${device.address})?`, [
          { label: device.connected ? 'Use this connected controller' : 'Pair/connect this device', value: 'connect' }, { label: 'Back to device list', value: 'back' },
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

const permissionHelp = 'Microphone access is denied. Allow Padcode Audio in macOS System Settings > Privacy & Security > Microphone, then choose Retry.';
// Voice stays off unless the user picks a microphone after reading what capture does.
async function chooseVoice(io: PromptPort, audio: AudioPort | undefined, signal: AbortSignal, initial?: Config, title = 'MISSION 05 / VOICE (optional)'): Promise<Config['voice']> {
  if (!audio) return initial?.voice ?? null;
  io.banner(title);
  if (!audio.supported) { io.say('Voice capture currently requires macOS. Voice stays off.'); return null; }
  const current = initial?.voice;
  const first = await io.choose('Voice input (hold L2 to record in an Agent session)', [
    ...(current ? [{ label: `Keep microphone ${cleanName(current.microphone.name)}`, value: 'keep' }] : []),
    { label: current ? 'Turn voice off' : 'Keep voice off', value: 'off' },
    { label: 'Choose a microphone', value: 'choose' },
  ]);
  if (first === 'keep') return current!;
  if (first === 'off') return null;
  io.say('CAPTURE  macOS AVAudioEngine through padcode-audio, only while you hold L2.');
  io.say('PRIVACY  Audio stays on this Mac in a private temporary folder and is deleted when the session ends.');
  io.say('TEXT     Transcription is not available yet; recordings can only be played back.');
  for (;;) {
    signal.throwIfAborted();
    try {
      let status = await audio.permission();
      if (status === 'not-determined') { io.say('macOS will now ask whether Padcode Audio may use the microphone.'); status = await audio.request(); }
      if (status !== 'authorized') throw new Error(status === 'restricted' ? 'Microphone access is restricted on this Mac.' : permissionHelp);
      const devices = await audio.list();
      if (!devices.length) throw new Error('No microphone is connected. Connect one, then choose Retry.');
      const picked = await io.choose('Choose a microphone', devices.map((device, index) => ({ label: `${cleanName(device.name)}${device.default ? ' / system default' : ''}`, value: String(index) })),
        Math.max(0, devices.findIndex(device => current ? device.id === current.microphone.id : device.default)));
      const device = devices[Number(picked)];
      if (!device) throw new Error('Selected microphone is no longer available.');
      if (await io.choose('Microphone check', [{ label: 'Record 3 seconds and play it back', value: 'test' }, { label: 'Skip the check', value: 'skip' }]) === 'test') {
        const directory = await voiceDirectory();
        try {
          io.say('RECORDING 3 SECONDS... speak now.');
          const recording = audio.record({ path: join(directory, 'check.wav'), device: device.id, maxSeconds: 3 });
          const result = await recording.done;
          if (result.kind !== 'stopped') throw new Error(result.kind === 'error' ? result.message : 'The check recording was cancelled.');
          io.say(`PLAYING BACK ${result.seconds.toFixed(1)}s...`);
          await audio.play(join(directory, 'check.wav')).done;
        } finally { await rm(directory, { recursive: true, force: true }); }
      }
      return { microphone: { id: device.id, name: cleanName(device.name) } };
    } catch (error) {
      signal.throwIfAborted();
      if ((error as Error).message === 'Setup cancelled.') throw error;
      io.say(`VOICE NOT READY: ${(error as Error).message}`);
      if (await io.choose('Recovery', [{ label: 'Retry', value: 'retry' }, { label: 'Keep voice off', value: 'off' }]) === 'off') return null;
    }
  }
}

export async function setup(io: PromptPort, services: SetupServices, signal: AbortSignal, initial?: Config): Promise<Config | null> {
  const linked = await linkController(io, services, signal, initial);
  if (linked.address || linked.transport === 'usb') await services.activateMenus?.(linked);
  const controller = await verifyInput(io, services, linked, signal);
  const agent = await chooseAgent(io, services, initial);
  io.banner('MISSION 04 / LOADOUT');
  await io.choose('Key profile', [{ label: 'Terminal basic / D-pad arrows, X Enter, O Escape, L1 Tab / R1 Shift+Tab', value: 'terminal-basic' }]);
  const voice = await chooseVoice(io, services.audio, signal, initial);
  const config: Config = { version: 2, controller, agent, profile: 'terminal-basic', voice };
  io.banner(services.audio ? 'MISSION 06 / SAVE POINT' : 'MISSION 05 / SAVE POINT');
  io.say(`LINK    ${controller.transport.toUpperCase()} / ${controller.name ?? 'not selected'}`);
  io.say(`INPUT   ${controller.inputVerified ? 'verified during this setup' : 'UNVERIFIED'}`);
  io.say(`AGENT   ${agent?.command ?? 'not selected'}`);
  if (agent?.args.length) io.say(`ARGS    ${JSON.stringify(agent.args)}`);
  io.say('PROFILE terminal-basic');
  io.say(`VOICE   ${voice ? cleanName(voice.microphone.name) : 'off'}`);
  io.say('Saving does not launch your Agent. Start a session explicitly from Player Hub.');
  if (await io.choose('Save this configuration?', [{ label: 'Save locally', value: 'save' }, { label: 'Cancel / keep previous configuration', value: 'cancel' }]) === 'cancel') return null;
  signal.throwIfAborted();
  await services.save(config);
  io.say('SAVE COMPLETE');
  return config;
}

type HubStep = { exit: number } | { action: 'hub' | 'config' | 'controllers'; notice?: string }
  | { action: 'run'; agent: NonNullable<Config['agent']>; controller: Config['controller']; handedOff: MenuFeed | undefined; display: Display; voice: Config['voice'] };

// Every Hub screen returns here; only Exit, q or a signal leaves Padcode.
export async function onboarding(edit = false, menus = new GamepadMenus(), lab: { helper?: string; helperArgs?: string[] } = {}, audio: AudioPort = new NativeAudio()): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stderr.write('Setup requires an interactive terminal. Run padcode --help for commands.\n'); return 2; }
  let editing = edit, notice: string | undefined;
  for (;;) {
    const step = await hubStep(editing, menus, audio, notice);
    editing = false; notice = undefined;
    if ('exit' in step) return step.exit;
    if (step.action === 'hub') { notice = step.notice; continue; }
    if (step.action === 'config') { editing = true; continue; }
    if (step.action === 'controllers') {
      const code = await session({ demo: false, json: false, ...lab });
      if (code === 130 || code === 143) return code;
      continue;
    }
    if (step.action !== 'run') continue;
    try { notice = `SESSION OVER / Agent exited with status ${await launchConfigured(step.agent, step.controller, step.handedOff, step.display, step.voice)}`; }
    catch (error) { notice = `SESSION FAILED / ${(error as Error).message}`; }
  }
}
async function hubStep(edit: boolean, menus: GamepadMenus, audio: AudioPort, notice?: string): Promise<HubStep> {
  const controller = new AbortController();
  let exitCode = 130;
  const cancel = () => controller.abort();
  const terminate = () => { exitCode = 143; controller.abort(); };
  process.on('SIGINT', cancel); process.on('SIGTERM', terminate);
  const io = new TerminalPrompt(controller.signal, cancel, menus);
  let saved = false;
  try {
    let config: Config | null;
    try { config = await loadConfig(); }
    catch (error) {
      io.say((error as Error).message);
      if (await io.choose('Existing file will only be replaced after a successful save', [{ label: 'Reconfigure', value: 'reset' }, { label: 'Exit and preserve file', value: 'exit' }]) === 'exit') return { exit: 1 };
      config = null; edit = true;
    }
    saved = Boolean(config);
    if (config && (config.controller.address || config.controller.transport === 'usb')) await menus.activate(config.controller, controller.signal, true);
    if (!config || edit) {
      const updated = await setup(io, {
        bluetooth: new NativeBluetooth(), audio, probe: () => menus.probe(), activateMenus: target => menus.activate(target, controller.signal), agents: discoverAgents, resolve: resolveExecutable, save: saveConfig,
      }, controller.signal, config ?? undefined);
      if (!updated) {
        io.say('No configuration changes saved.');
        return config ? { action: 'hub' } : { exit: 0 };
      }
      config = updated;
      io.say(`Configuration: ${configPath()}`);
    }
    io.banner('PLAYER HUB');
    if (notice) io.say(notice);
    io.say(`LINK ${config.controller.transport.toUpperCase()} / ${config.controller.name ?? 'not selected'}`);
    io.say(`INPUT ${config.controller.inputVerified ? 'last setup check passed (not a live connection status)' : 'UNVERIFIED'}`);
    io.say(`AGENT ${config.agent?.command ?? 'not selected'}`);
    io.say('AGENT CONTROLS / D-pad, X, O, L1, R1 / Options opens the controls menu (pause in transparent mode).');
    io.say(`VOICE ${config.voice ? `${cleanName(config.voice.microphone.name)} / hold L2 to record` : 'off'}`);
    const action = await io.choose('Ready when you are', [
      { label: 'Controller lab / test live input (hold O to return)', value: 'controllers' },
      { label: 'Edit configuration', value: 'config' },
      { label: 'Preview arcade dashboard', value: 'demo' },
      { label: 'Exit', value: 'quit' },
      ...(config.agent ? [{ label: 'Start agent session', value: 'run' }] : []),
      { label: 'Voice / microphone settings', value: 'voice' },
    ]);
    if (action === 'run' && config.agent) {
      const display = await chooseDisplay();
      if (!await confirmAgent(io, config.agent, process.cwd(), display)) return { action: 'hub', notice: 'LAUNCH CANCELLED / Back at Player Hub.' };
      return { action: 'run', agent: config.agent, controller: config.controller, handedOff: menus.handoff(), display, voice: config.voice };
    }
    if (action === 'demo') {
      // The demo has no input helper, so the Hub's own feed provides O to return.
      const code = await session({ demo: true, json: false, back: menus });
      return code === 130 || code === 143 ? { exit: code } : { action: 'hub' };
    }
    if (action === 'voice') {
      // Voice settings can change on their own; the rest of the configuration is kept as saved.
      let voice: Config['voice'];
      try { voice = await chooseVoice(io, audio, controller.signal, config, 'VOICE SETTINGS'); }
      catch (error) {
        if ((error as Error).message !== 'Setup cancelled.' || controller.signal.aborted) throw error;
        return { action: 'hub', notice: 'VOICE UNCHANGED / Back at Player Hub.' };
      }
      await saveConfig({ ...config, voice });
      return { action: 'hub', notice: voice ? `VOICE ON / ${cleanName(voice.microphone.name)}, hold L2 in a session` : 'VOICE OFF' };
    }
    if (action === 'controllers' || action === 'config') return { action };
    return { exit: 0 };
  } catch (error) {
    if (controller.signal.aborted) { io.say('Setup cancelled. No pending configuration changes saved.'); return { exit: exitCode }; }
    if ((error as Error).message === 'Setup cancelled.') {
      if (edit && saved) { io.say('No configuration changes saved.'); return { action: 'hub' }; }
      return { exit: 0 };
    }
    io.say(`SETUP STOPPED: ${(error as Error).message}`); return { exit: 1 };
  } finally {
    await menus.stop(); io.close(); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', terminate);
  }
}
