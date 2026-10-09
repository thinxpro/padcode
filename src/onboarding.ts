import { confirmAgent, launchConfigured } from './agent-session.js';
import { chooseDisplay, type Display } from './tmux.js';
import { configPath, discoverAgents, loadConfig, resolveExecutable, saveConfig, validLanguage, validTranscriber, type Config, type Transcriber } from './config.js';
import { NativeBluetooth, type BluetoothPort } from './bluetooth.js';
import { identityMatch, type ProbePort } from './probe.js';
import { TerminalPrompt, type PromptPort } from './prompt.js';
import type { Progress } from './prompt-view.js';
import { session } from './session.js';
import { GamepadMenus, type MenuFeed } from './menu-controller.js';
import { mergeDeviceChoices, scanDeviceChoices } from './bluetooth-picker.js';
import { NativeAudio, type AudioPort } from './audio.js';
import { familyFromName, formatGlyphs, pairingHints } from './glyphs.js';
import { renderHub, type HubModel } from './hub-view.js';
import { version } from './version.js';
import { downloadModel, findModels, findWhisper, modelDirectory, transcribe, whisperModels, whisperSource, whisperTranscriber, writeSilentWav } from './transcribe.js';
import { rm } from 'node:fs/promises';
import { voiceDirectory } from './voice-session.js';
import { basename, join } from 'node:path';

export interface SetupServices {
  activateMenus?: (controller: Config['controller']) => Promise<void>;
  bluetooth: BluetoothPort;
  probe: () => ProbePort;
  agents: typeof discoverAgents;
  resolve: typeof resolveExecutable;
  save: (config: Config) => Promise<void>;
  audio?: AudioPort;
  whisper?: WhisperTools;
}
export interface WhisperTools { findWhisper: () => Promise<string | null>; findModels: () => Promise<string[]> }
const systemWhisper: WhisperTools = { findWhisper: () => findWhisper(), findModels: () => findModels() };
let introPlayed = false;
const cleanName = (text: string) => text.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512);

async function linkController(io: PromptPort, services: SetupServices, signal: AbortSignal, initial: Config | undefined, total: number): Promise<Config['controller']> {
  io.banner('MISSION 01 / LINK CONTROLLER', [1, total]);
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
          { label: 'Scan nearby / put the controller in pairing mode first', value: 'scan' },
          ...devices.map((device, i) => ({ label: `${cleanName(device.name)} / ${device.address} / ${device.cached ? 'status unknown / cached' : device.connected ? 'connected' : device.paired ? 'paired' : 'new'} / ${device.source}`, value: String(i) })),
          { label: 'Use USB instead', value: 'usb' },
          { label: 'Configure Bluetooth later', value: 'later' },
        ]);
        if (selected === 'scan') {
          // Pairing differs by controller; the family is not known until SDL sees the device.
          for (const hint of Object.values(pairingHints)) io.say(`PAIRING  ${hint}`);
          io.say('SCANNING... keep pairing mode active (20-second scan; up to 35 seconds including macOS initialization).');
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
        const family = familyFromName(device.name);
        if (!device.paired && family && family !== 'standard') io.say(`PAIRING  ${pairingHints[family]}`);
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

async function verifyInput(io: PromptPort, services: SetupServices, controller: Config['controller'], signal: AbortSignal, total: number): Promise<Config['controller']> {
  io.banner('MISSION 02 / INPUT CHECK', [2, total]);
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
      // The verified controller's family names its buttons everywhere ({confirm}, {menu}...).
      return { ...controller, name: controller.name ?? cleanName(device.name), inputVerified: true, ...(device.family ? { family: device.family } : {}) };
    } catch (error) {
      signal.throwIfAborted();
      if ((error as Error).message === 'Setup cancelled.') throw error;
      io.say(`INPUT NOT VERIFIED: ${(error as Error).message}`);
    } finally { await probe.stop(); }
  }
}

async function chooseAgent(io: PromptPort, services: SetupServices, initial: Config | undefined, total: number): Promise<Config['agent']> {
  io.banner('MISSION 03 / CHOOSE YOUR AGENT', [3, total]);
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
// Every path that records checks access first: development builds lose the macOS grant when rebuilt.
async function microphoneReady(io: PromptPort, audio: AudioPort): Promise<boolean> {
  let status = await audio.permission();
  if (status === 'not-determined') { io.say('macOS will now ask whether Padcode Audio may use the microphone.'); status = await audio.request(); }
  if (status === 'authorized') return true;
  io.say(status === 'restricted' ? 'Microphone access is restricted on this Mac.' : permissionHelp);
  return false;
}
// Voice stays off unless the user picks a microphone after reading what capture does.
async function chooseVoice(io: PromptPort, audio: AudioPort | undefined, signal: AbortSignal, initial?: Config, title = 'MISSION 05 / VOICE (optional)', whisper = systemWhisper, progress?: Progress): Promise<Config['voice']> {
  if (!audio) return initial?.voice ?? null;
  io.banner(title, progress);
  if (!audio.supported) { io.say('Voice capture currently requires macOS. Voice stays off.'); return null; }
  const current = initial?.voice;
  const first = await io.choose('Voice input (hold {l2} to record in an Agent session)', [
    ...(current ? [{ label: `Keep microphone ${cleanName(current.microphone.name)}`, value: 'keep' }] : []),
    { label: current ? 'Turn voice off' : 'Keep voice off', value: 'off' },
    { label: 'Choose a microphone', value: 'choose' },
  ]);
  if (first === 'keep') {
    await microphoneReady(io, audio);
    const transcriber = await chooseTranscriber(io, audio, signal, current!.microphone.id, current!.transcriber, whisper);
    return { microphone: current!.microphone, transcriber, insert: await chooseInsert(io, transcriber, current!.insert) };
  }
  if (first === 'off') return null;
  io.say('CAPTURE  macOS AVAudioEngine through padcode-audio, only while you hold {l2}.');
  io.say('PRIVACY  Audio stays on this Mac in a private temporary folder and is deleted when the session ends.');
  for (;;) {
    signal.throwIfAborted();
    try {
      if (!await microphoneReady(io, audio)) throw new Error('The microphone is not available to Padcode Audio.');
      const devices = await audio.list();
      if (!devices.length) throw new Error('No microphone is connected. Connect one, then choose Retry.');
      if (devices.some(device => device.transport === 'bluetooth')) io.say('NOTE     Bluetooth headset microphones take about a second to start and switch the headset to lower call quality; a wired, USB or built-in microphone works best.');
      const picked = await io.choose('Choose a microphone', devices.map((device, index) => ({ label: `${cleanName(device.name)}${device.transport === 'bluetooth' ? ' / Bluetooth' : device.transport === 'usb' ? ' / USB' : device.transport === 'built-in' ? ' / built-in' : ''}${device.default ? ' / system default' : ''}`, value: String(index) })),
        Math.max(0, devices.findIndex(device => current ? device.id === current.microphone.id : device.default)));
      const device = devices[Number(picked)];
      if (!device) throw new Error('Selected microphone is no longer available.');
      if (await io.choose('Microphone check', [{ label: 'Record 3 seconds and play it back', value: 'test' }, { label: 'Skip the check', value: 'skip' }]) === 'test') {
        const directory = await voiceDirectory();
        try {
          io.say('MIC STARTING...');
          const recording = audio.record({ path: join(directory, 'check.wav'), device: device.id, maxSeconds: 3 });
          recording.onLive(() => io.say('RECORDING 3 SECONDS... speak now.'));
          const result = await recording.done;
          if (result.kind !== 'stopped') throw new Error(result.kind === 'error' ? result.message : 'The check recording was cancelled.');
          io.say(`PLAYING BACK ${result.seconds.toFixed(1)}s...`);
          await audio.play(join(directory, 'check.wav')).done;
        } finally { await rm(directory, { recursive: true, force: true }); }
      }
      const transcriber = await chooseTranscriber(io, audio, signal, device.id, current?.transcriber ?? null, whisper);
      return { microphone: { id: device.id, name: cleanName(device.name) }, transcriber, insert: await chooseInsert(io, transcriber, current?.insert) };
    } catch (error) {
      signal.throwIfAborted();
      if ((error as Error).message === 'Setup cancelled.') throw error;
      io.say(`VOICE NOT READY: ${(error as Error).message}`);
      if (await io.choose('Recovery', [{ label: 'Retry', value: 'retry' }, { label: 'Keep voice off', value: 'off' }]) === 'off') return null;
    }
  }
}

// Automatic insertion types the draft into the Agent's input without Enter; review shows it first.
async function chooseInsert(io: PromptPort, transcriber: Transcriber | null, current: 'auto' | 'review' = 'auto'): Promise<'auto' | 'review'> {
  if (!transcriber) return current;
  return await io.choose('After transcription', [
    { label: 'Insert into the Agent input automatically (never sends)', value: 'auto' },
    { label: 'Show the draft first, insert on confirm', value: 'review' },
  ], current === 'review' ? 1 : 0) as 'auto' | 'review';
}
const describeTranscriber = (t: Transcriber) => t.kind === 'system' ? `macOS on-device speech (${t.language})`
  : `${cleanName(t.command.split('/').pop() ?? t.command)} (${t.language})`;
const languages = [{ label: 'Chinese (zh)', value: 'zh' }, { label: 'English (en)', value: 'en' }, { label: 'Detect automatically', value: 'auto' }, { label: 'Other language code', value: 'other' }];
// Transcription tiers: macOS on-device speech, guided whisper.cpp, or a custom command; every choice is tested before saving.
async function chooseTranscriber(io: PromptPort, audio: AudioPort, signal: AbortSignal, microphone: string, current: Transcriber | null, whisper: WhisperTools): Promise<Transcriber | null> {
  io.banner('VOICE / TRANSCRIPTION');
  io.say('TEXT     Turns each {l2} clip into a draft you review before anything reaches the Agent.');
  io.say('PRIVACY  Padcode sends audio nowhere. macOS on-device speech and whisper.cpp run on this Mac; a custom command decides its own network use.');
  for (;;) {
    signal.throwIfAborted();
    const kind = await io.choose('Transcription', [
      ...(current ? [{ label: `Keep ${describeTranscriber(current)}`, value: 'keep' }] : []),
      { label: 'macOS on-device speech / nothing to install', value: 'system' },
      { label: 'whisper.cpp / best accuracy, guided setup', value: 'whisper' },
      { label: 'Custom command', value: 'custom' },
      { label: 'No transcription / record and play back only', value: 'none' },
    ]);
    if (kind === 'keep') return current;
    if (kind === 'none') return null;
    try {
      let language = await io.choose('Spoken language', languages, Math.max(0, languages.findIndex(item => item.value === (current?.language ?? 'zh'))));
      if (language === 'other') {
        language = (await io.ask('Language code (2-3 lowercase letters, for example ja):')).trim();
        if (!validLanguage(language)) throw new Error('Use a 2-3 letter language code such as ja, or auto.');
      }
      let transcriber: Transcriber;
      if (kind === 'system') {
        transcriber = { kind: 'system', language };
        let status = await audio.speechPermission();
        if (status === 'not-determined') { io.say('macOS will now ask whether Padcode Audio may use Speech Recognition.'); status = await audio.speechRequest(); }
        if (status !== 'authorized') throw new Error('Speech recognition is not allowed. Allow Padcode Audio in System Settings > Privacy & Security > Speech Recognition, then choose Retry.');
      } else if (kind === 'whisper') {
        const cli = await whisper.findWhisper();
        if (!cli) throw new Error('whisper.cpp is not installed. Install it yourself (macOS: brew install whisper-cpp), then choose Retry.');
        transcriber = whisperTranscriber(cli, await chooseModel(io, signal, whisper), language);
      } else {
        const command = await resolveExecutable(await io.ask('Transcriber executable (path or command name, no arguments):'));
        if (!command) throw new Error('Executable not found.');
        io.say('Arguments are literal values, one per line. {audio} becomes the WAV path and must appear; {language} is optional. Empty finishes.');
        const args: string[] = [];
        for (;;) {
          const argument = await io.ask(`Argument ${args.length + 1} (Enter to finish):`);
          if (!argument) break;
          if (/[\x00-\x1f\x7f]/.test(argument) || argument.length > 4096) { io.say('Argument is too long or contains control characters.'); continue; }
          args.push(argument);
          if (args.length === 64) break;
        }
        transcriber = { kind: 'command', command, args, language };
        if (!validTranscriber(transcriber)) throw new Error('Add an argument containing {audio}.');
      }
      const directory = await voiceDirectory();
      try {
        io.say('SELF-TEST  Transcribing one second of silence...');
        await writeSilentWav(join(directory, 'silence.wav'));
        const began = Date.now(), result = await transcribe(transcriber, join(directory, 'silence.wav'), audio).done;
        if (!result.ok) throw new Error(`Self-test failed: ${result.message}`);
        io.say(`SELF-TEST PASSED in ${((Date.now() - began) / 1000).toFixed(1)}s.`);
        for (let attempt = 1; await io.choose('Try it', [{ label: attempt === 1 ? 'Record 5 seconds and show the text' : 'Try again', value: 'try' }, { label: 'Done', value: 'done' }], attempt === 1 ? 1 : 0) === 'try'; attempt++) {
          signal.throwIfAborted();
          if (!await microphoneReady(io, audio)) continue;
          await rm(join(directory, 'try.wav'), { force: true });
          io.say('MIC STARTING...');
          const recording = audio.record({ path: join(directory, 'try.wav'), device: microphone, maxSeconds: 5 });
          recording.onLive(() => io.say('RECORDING 5 SECONDS... speak now.'));
          const clip = await recording.done;
          if (clip.kind === 'stopped') {
            io.say('TRANSCRIBING...');
            const heard = await transcribe(transcriber, join(directory, 'try.wav'), audio).done;
            io.say(heard.ok ? `HEARD  ${heard.text || '(no speech recognized)'}` : `TRY FAILED: ${heard.message}`);
          } else io.say(`TRY FAILED: ${clip.kind === 'error' ? clip.message : 'cancelled'}`);
        }
      } finally { await rm(directory, { recursive: true, force: true }); }
      return transcriber;
    } catch (error) {
      signal.throwIfAborted();
      if ((error as Error).message === 'Setup cancelled.') throw error;
      io.say(`TRANSCRIPTION NOT READY: ${(error as Error).message}`);
    }
  }
}
async function chooseModel(io: PromptPort, signal: AbortSignal, whisper: WhisperTools): Promise<string> {
  const found = await whisper.findModels();
  const choice = await io.choose('whisper.cpp model', [
    ...found.map((path, index) => ({ label: `Use ${path}`, value: `found:${index}` })),
    ...whisperModels.map((model, index) => ({ label: `Download ${model.label}`, value: `download:${index}` })),
  ]);
  if (choice.startsWith('found:')) return found[Number(choice.slice(6))]!;
  const model = whisperModels[Number(choice.slice(9))]!, directory = modelDirectory();
  io.say(`SOURCE   ${whisperSource}/${model.file}`);
  io.say(`SIZE     ${(model.size / 1e6).toFixed(0)} MB, verified with SHA-256 ${model.sha256.slice(0, 16)}...`);
  io.say(`SAVE TO  ${join(directory, model.file)}`);
  if (await io.choose('Download this model now?', [{ label: 'Download', value: 'yes' }, { label: 'Cancel', value: 'cancel' }], 1) !== 'yes') throw new Error('Model download cancelled; nothing was downloaded.');
  let shown = -1;
  const path = await downloadModel(model, directory, {
    signal, ...(process.env.PADCODE_MODEL_SOURCE ? { source: process.env.PADCODE_MODEL_SOURCE } : {}),
    onProgress: (bytes, total) => { const step = Math.floor(bytes / total * 10); if (step !== shown) { shown = step; io.say(`DOWNLOAD ${step * 10}%  (Ctrl+C cancels)`); } },
  });
  io.say('DOWNLOAD COMPLETE / checksum verified.');
  return path;
}

// Nintendo prints A on the right button. Confirm stays positional (bottom) unless the user prefers A.
async function chooseConfirm(io: PromptPort, controller: Config['controller'], initial?: Config): Promise<Config['controller']> {
  const { confirm: _previous, ...rest } = controller;
  if (controller.family !== 'nintendo') return rest;
  const choice = await io.choose('Confirm button on this Nintendo controller', [
    { label: 'B (bottom) confirms, like other controllers', value: 'south' },
    { label: 'A (right) confirms, Nintendo style', value: 'east' },
  ], initial?.controller.confirm === 'east' ? 1 : 0);
  return choice === 'east' ? { ...rest, confirm: 'east' } : rest;
}

export async function setup(io: PromptPort, services: SetupServices, signal: AbortSignal, initial?: Config): Promise<Config | null> {
  // Voice is a mission only where capture is supported (macOS), so the total is 6 or 5.
  const total = services.audio ? 6 : 5;
  const linked = await linkController(io, services, signal, initial, total);
  if (linked.address || linked.transport === 'usb') await services.activateMenus?.(linked);
  const verified = await verifyInput(io, services, linked, signal, total);
  const controller = await chooseConfirm(io, { ...verified, ...(initial?.controller.family && !verified.family ? { family: initial.controller.family } : {}) }, initial);
  const agent = await chooseAgent(io, services, initial, total);
  io.banner('MISSION 04 / LOADOUT', [4, total]);
  await io.choose('Key profile', [{ label: 'Terminal basic / D-pad arrows, {confirm} Enter, {back} Escape, {l1} Tab / {r1} Shift+Tab', value: 'terminal-basic' }]);
  const voice = await chooseVoice(io, services.audio, signal, initial, undefined, services.whisper, [5, total]);
  const config: Config = { version: 2, controller, agent, profile: 'terminal-basic', voice };
  io.banner(services.audio ? 'MISSION 06 / SAVE POINT' : 'MISSION 05 / SAVE POINT', [total, total]);
  io.say(`LINK    ${controller.transport.toUpperCase()} / ${controller.name ?? 'not selected'}`);
  io.say(`INPUT   ${controller.inputVerified ? 'verified during this setup' : 'UNVERIFIED'}`);
  io.say(`AGENT   ${agent?.command ?? 'not selected'}`);
  if (agent?.args.length) io.say(`ARGS    ${JSON.stringify(agent.args)}`);
  io.say('PROFILE terminal-basic');
  io.say(`VOICE   ${voice ? `${cleanName(voice.microphone.name)} / ${voice.transcriber ? describeTranscriber(voice.transcriber) : 'no transcription'}` : 'off'}`);
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
    const agentName = config.agent ? basename(config.agent.command) : undefined;
    const choices = [
      // Most used first; the cursor starts on Start agent session, whose confirmation defaults to Cancel.
      ...(config.agent ? [{ label: 'START AGENT SESSION', value: 'run', detail: `${agentName} in ${basename(process.cwd()) || process.cwd()}` }] : []),
      { label: 'VOICE + MICROPHONE', value: 'voice', detail: config.voice ? 'change microphone or transcription' : 'set up dictation (macOS)' },
      { label: 'CONTROLLER LAB', value: 'controllers', detail: 'test live input / hold {back} to return' },
      { label: 'EDIT CONFIGURATION', value: 'config', detail: 'Bluetooth, agent and buttons' },
      { label: 'ARCADE DEMO', value: 'demo', detail: 'preview with synthetic input' },
      { label: 'EXIT', value: 'quit', detail: 'back to the shell' },
    ];
    const model: HubModel = {
      version: version(), notice,
      controller: { name: config.controller.name, transport: config.controller.transport, verified: Boolean(config.controller.inputVerified) },
      agent: agentName,
      voice: config.voice ? `${cleanName(config.voice.microphone.name)} / ${config.voice.transcriber ? describeTranscriber(config.voice.transcriber) : 'record only'} / hold {l2}` : undefined,
      items: choices, tip: 'TIP  In a session, {menu} opens the controls menu.',
    };
    // The welcome sweep plays once per process, on the first Hub frame.
    const action = await io.screen(choices, view => renderHub({ ...model, voice: model.voice && formatGlyphs(model.voice, view.glyphs) }, view), { intro: introPlayed ? 0 : 700 });
    introPlayed = true;
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
      return { action: 'hub', notice: voice ? `VOICE ON / ${cleanName(voice.microphone.name)}, hold {l2} in a session` : 'VOICE OFF' };
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
