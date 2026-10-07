import { lstat, mkdtemp, open, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AudioPort, Recording, RecordingResult } from './audio.js';
import type { Button } from './protocol.js';
import type { Transcriber } from './config.js';
import { transcribe, type TranscriptionJob } from './transcribe.js';

export interface VoiceEffects {
  routing(): boolean;
  capture(handler: (button: Button) => void, status: string): void;
  release(resume: boolean): void;
  status(text: string): void;
  notice(text: string): void;
  draft?(text: string): void;
}
export const startAt = 0.65, stopBelow = 0.35, debounceMs = 150, shortestSeconds = 0.3, liveLimitMs = 8000;
const meter = (peak: number) => { const n = Math.round(Math.min(1, peak * 2) * 10); return `[${'#'.repeat(n)}${'.'.repeat(10 - n)}]`; };
const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// Push-to-talk on L2: hysteresis and debounce decide edges; one recording exists at a time.
export class VoiceCapture {
  state: 'idle' | 'recording' | 'stopping' | 'transcribing' | 'playing' | 'permission' = 'idle';
  last: string | undefined;
  private pressed = false;
  private latest = 0;
  private lastChange = -Infinity;
  private timer: NodeJS.Timeout | undefined;
  private recording: Recording | undefined;
  private player: { stop(): void } | undefined;
  private cancelled = false;
  private job: TranscriptionJob | undefined;
  private liveTimer: NodeJS.Timeout | undefined;
  private abandoned = new Set<string>();
  private generation = 0;
  private count = 0;
  constructor(private audio: AudioPort, private directory: string, private microphone: string, private fx: VoiceEffects,
    private now: () => number = Date.now, private maxSeconds = 60, private transcriber: Transcriber | null = null, private liveLimit = liveLimitMs) {}
  trigger(value: number): void { this.latest = value; this.evaluate(); }
  private evaluate(): void {
    clearTimeout(this.timer); this.timer = undefined;
    const want = this.pressed ? this.latest >= stopBelow : this.latest >= startAt;
    if (want === this.pressed) return;
    const wait = this.lastChange + debounceMs - this.now();
    if (wait > 0) { this.timer = setTimeout(() => this.evaluate(), wait); return; }
    this.pressed = want; this.lastChange = this.now();
    if (want) this.start(); else this.stop();
  }
  // A press that arrives while the controller is not routing (arming, paused, menus) stays a press without
  // recording, so a trigger held through launch must be released and pressed again.
  private start(): void {
    if (this.state !== 'idle' || !this.fx.routing()) return;
    const generation = this.generation, path = join(this.directory, `rec-${++this.count}.wav`);
    let began: number | undefined;
    if (this.last) { void rm(this.last, { force: true }); this.last = undefined; }
    this.state = 'recording'; this.cancelled = false;
    const recording = this.audio.record({ path, device: this.microphone, maxSeconds: this.maxSeconds });
    this.recording = recording;
    const status = (peak: number) => began === undefined ? 'MIC STARTING / Keep holding L2, speak at REC'
      : `REC ${clock(this.now() - began)} ${meter(peak)} / Release L2 to stop, O cancel`;
    this.fx.capture(button => { if (button === 'east') this.cancel(); }, status(0));
    recording.onLive(() => { clearTimeout(this.liveTimer); if (this.recording !== recording) return; began = this.now(); if (this.state === 'recording') this.fx.status(status(0)); });
    // Backup for the helper's own watchdog: never leave MIC STARTING on screen indefinitely.
    clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => {
      if (this.recording !== recording || began !== undefined) return;
      // Give the controller back now; the stuck helper is killed in the background and its result ignored.
      this.abandoned.add(path); recording.cancel();
      this.recording = undefined; this.state = 'idle'; this.fx.release(true);
      this.fx.notice('MIC NOT RESPONDING / Reconnect it or choose another in Voice settings, then hold L2 again');
    }, this.liveLimit);
    this.liveTimer.unref();
    recording.onLevel(peak => { if (this.recording === recording && this.state === 'recording') this.fx.status(status(peak)); });
    void recording.done.then(result => this.finished(result, path, generation));
  }
  private stop(): void {
    if (this.state !== 'recording' || !this.recording) return;
    this.state = 'stopping'; this.recording.stop();
  }
  private finished(result: RecordingResult, path: string, generation: number): void {
    clearTimeout(this.liveTimer);
    if (generation !== this.generation) { void rm(path, { force: true }); return; }
    if (this.abandoned.delete(path)) { void rm(path, { force: true }); return; }
    this.recording = undefined; this.state = 'idle';
    if (result.kind === 'stopped' && !this.cancelled && result.seconds < shortestSeconds) {
      void rm(path, { force: true });
      this.fx.release(true); this.fx.notice('RECORDING TOO SHORT / Hold L2 until REC appears');
      return;
    }
    if (result.kind === 'stopped' && !this.cancelled) {
      this.last = path;
      if (this.transcriber) { this.transcribeClip(path, generation); return; }
      this.fx.release(true); this.fx.notice(`RECORDED ${result.seconds.toFixed(1)}s / Options > Play last recording`);
      return;
    }
    void rm(path, { force: true });
    this.fx.release(true);
    // Ad-hoc signed helpers lose their macOS grant when Padcode is updated; ask again right here.
    if (result.kind === 'error' && result.code === 'permission-required') { this.requestPermission(generation); return; }
    if (result.kind === 'error' && result.code === 'permission-denied') { this.fx.notice('MIC DENIED / Allow Padcode Audio in System Settings > Privacy & Security > Microphone'); return; }
    this.fx.notice(result.kind === 'error' ? `MIC ERROR / ${result.message}` : 'RECORDING CANCELLED');
  }
  // The controller stays captured while the draft is produced; O cancels it. Nothing reaches the Agent.
  private transcribeClip(path: string, generation: number): void {
    this.state = 'transcribing'; this.cancelled = false;
    this.fx.capture(button => { if (button === 'east') this.cancel(); }, 'TRANSCRIBING... / O cancel');
    const job = transcribe(this.transcriber!, path, this.audio);
    this.job = job;
    void job.done.then(result => {
      if (generation !== this.generation || this.job !== job) return;
      this.job = undefined; this.state = 'idle'; this.fx.release(true);
      if (result.ok) { if (result.text) this.fx.draft?.(result.text); else this.fx.notice('NO SPEECH RECOGNIZED / Hold L2 and try again'); return; }
      if (result.code === 'speech-permission-required') { this.requestSpeech(generation); return; }
      this.fx.notice(this.cancelled || result.code === 'cancelled' ? 'TRANSCRIPTION CANCELLED' : `TRANSCRIPTION FAILED / ${result.message}`);
    });
  }
  private requestSpeech(generation: number): void {
    this.state = 'permission';
    this.fx.notice('SPEECH PERMISSION / Answer the macOS dialog for Padcode Audio');
    void this.audio.speechRequest().then(status => {
      if (generation !== this.generation) return;
      this.state = 'idle';
      this.fx.notice(status === 'authorized' ? 'SPEECH READY / Hold L2 to record again'
        : 'SPEECH DENIED / Allow Padcode Audio in System Settings > Privacy & Security > Speech Recognition');
    }, () => { if (generation === this.generation) { this.state = 'idle'; this.fx.notice('SPEECH PERMISSION FAILED'); } });
  }
  private requestPermission(generation: number): void {
    this.state = 'permission';
    this.fx.notice('MIC PERMISSION / Answer the macOS dialog for Padcode Audio');
    void this.audio.request().then(status => {
      if (generation !== this.generation) return;
      this.state = 'idle';
      this.fx.notice(status === 'authorized' ? 'MIC READY / Hold L2 again to record'
        : 'MIC DENIED / Allow Padcode Audio in System Settings > Privacy & Security > Microphone');
    }, (error: Error) => {
      if (generation !== this.generation) return;
      this.state = 'idle'; this.fx.notice(`MIC ERROR / ${error.message}`);
    });
  }
  cancel(): void {
    if (this.recording) { this.cancelled = true; this.recording.cancel(); }
    if (this.job) { this.cancelled = true; this.job.cancel(); }
    this.player?.stop();
  }
  play(): void {
    if (!this.last || this.state !== 'idle') return;
    this.state = 'playing';
    const playback = this.audio.play(this.last);
    this.player = playback;
    this.fx.capture(button => { if (button === 'east' || button === 'start') playback.stop(); }, 'PLAYING / O stop');
    void playback.done.then(() => { this.player = undefined; this.state = 'idle'; this.fx.release(true); });
  }
  // Session end: stop everything; late helper results only delete their files.
  dispose(): void { this.generation++; clearTimeout(this.timer); clearTimeout(this.liveTimer); this.recording?.cancel(); this.job?.cancel(); this.player?.stop(); }
}

// Per-session voice directory with an owner record used by stale recovery.
export async function voiceDirectory(root = tmpdir()): Promise<string> {
  const directory = await mkdtemp(join(root, 'pcv-'));
  const owner = await open(join(directory, 'owner'), 'wx', 0o600);
  try { await owner.writeFile(String(process.pid)); } finally { await owner.close(); }
  return directory;
}
// Removes pcv- directories left by crashed sessions. Never follows symlinks or touches other users' files.
export async function removeStaleVoice(root = tmpdir(), alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } }): Promise<number> {
  let removed = 0;
  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (!/^pcv-[A-Za-z0-9]{6}$/.test(name)) continue;
    const directory = join(root, name);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700) continue;
      const ownerInfo = await lstat(join(directory, 'owner'));
      if (!ownerInfo.isFile() || ownerInfo.uid !== info.uid) continue;
      const pid = Number(await readFile(join(directory, 'owner'), 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0 || alive(pid)) continue;
      await rm(directory, { recursive: true, force: true }); removed++;
    } catch { /* Missing owner records are left alone. */ }
  }
  return removed;
}
