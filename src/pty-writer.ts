import { write } from 'node:fs';

// node-pty's pinned Unix fd avoids its unbounded internal write queue.
export class PtyWriter {
  private queue: Buffer[] = [];
  private bytes = 0;
  private active = false;
  private closed = false;
  private timer: NodeJS.Timeout | undefined;
  private retry: NodeJS.Timeout | undefined;
  constructor(private fd: number, private pause: () => void, private resume: () => void, private fail: (error: Error) => void, private timeout = 10000) {}
  push(data: Buffer): void {
    if (this.closed || !data.length) return;
    if (this.bytes + data.length > 1024 * 1024) { this.fail(new Error('Agent input queue exceeded 1 MiB.')); return; }
    this.queue.push(data); this.bytes += data.length;
    if (this.bytes >= 65536) this.pause();
    this.pump();
  }
  private pump(): void {
    if (this.closed || this.active || !this.queue.length) return;
    this.active = true;
    this.timer ??= setTimeout(() => this.fail(new Error('Agent input stalled.')), this.timeout);
    const buffer = this.queue[0]!;
    write(this.fd, buffer, (error, count) => {
      this.active = false;
      if (this.closed) return;
      if (error && !['EAGAIN', 'EINTR'].includes(error.code ?? '')) { this.fail(error); return; }
      if (error || count === 0) { this.retry = setTimeout(() => this.pump(), 5); return; }
      clearTimeout(this.timer); this.timer = undefined;
      this.bytes -= count;
      if (count === buffer.length) this.queue.shift(); else this.queue[0] = buffer.subarray(count);
      if (this.bytes < 65536) this.resume();
      this.pump();
    });
  }
  close(): void { this.closed = true; clearTimeout(this.timer); clearTimeout(this.retry); this.queue = []; this.bytes = 0; }
}
