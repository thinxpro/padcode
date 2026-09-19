import { write } from 'node:fs';

type WriteChunk = (fd: number, buffer: Buffer, callback: (error: NodeJS.ErrnoException | null, count: number) => void) => void;

// node-pty's pinned Unix fd avoids its unbounded internal write queue.
export class PtyWriter {
  private queue: { data: Buffer; controller: boolean; cancelled: boolean }[] = [];
  private bytes = 0;
  private active = false;
  private closed = false;
  private timer: NodeJS.Timeout | undefined;
  private retry: NodeJS.Timeout | undefined;
  constructor(private fd: number, private pause: () => void, private resume: () => void, private fail: (error: Error) => void, private timeout = 10000, private writeChunk: WriteChunk = (fd, data, callback) => write(fd, data, callback)) {}
  push(data: Buffer, controller = false): void {
    if (this.closed || !data.length) return;
    if (this.bytes + data.length > 1024 * 1024) { this.fail(new Error('Agent input queue exceeded 1 MiB.')); return; }
    this.queue.push({ data, controller, cancelled: false }); this.bytes += data.length;
    if (this.bytes >= 65536) this.pause();
    this.pump();
  }
  private pump(): void {
    if (this.closed || this.active || !this.queue.length) return;
    this.active = true;
    this.timer ??= setTimeout(() => this.fail(new Error('Agent input stalled.')), this.timeout);
    const entry = this.queue[0]!;
    const buffer = entry.data;
    this.writeChunk(this.fd, buffer, (error, count) => {
      this.active = false;
      if (this.closed) return;
      if (entry.cancelled) {
        this.bytes -= entry.data.length; this.queue.shift();
        clearTimeout(this.timer); this.timer = undefined;
        if (this.bytes < 65536) this.resume();
        this.pump(); return;
      }
      if (error && !['EAGAIN', 'EINTR'].includes(error.code ?? '')) { this.fail(error); return; }
      if (error || count === 0) { this.retry = setTimeout(() => this.pump(), 5); return; }
      clearTimeout(this.timer); this.timer = undefined;
      this.bytes -= count;
      if (count === buffer.length) this.queue.shift(); else entry.data = buffer.subarray(count);
      if (this.bytes < 65536) this.resume();
      this.pump();
    });
  }
  discardController(): void {
    this.queue = this.queue.filter((entry, index) => {
      if (!entry.controller) return true;
      if (index === 0 && this.active) { entry.cancelled = true; return true; }
      this.bytes -= entry.data.length; return false;
    });
    if (!this.queue.length) { clearTimeout(this.timer); this.timer = undefined; clearTimeout(this.retry); }
    if (this.bytes < 65536) this.resume();
  }
  close(): void { this.closed = true; clearTimeout(this.timer); clearTimeout(this.retry); this.queue = []; this.bytes = 0; }
}
