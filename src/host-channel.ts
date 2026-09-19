import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function hostChannel(): Promise<{ path: string; onExit: (callback: () => void) => void; acknowledge: () => void; close: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'pc-'));
  const path = join(directory, 's');
  let peer: Socket | undefined, received = false, callback = () => {};
  const server = createServer(socket => {
    if (peer) { socket.destroy(); return; }
    peer = socket; let message = '';
    socket.on('error', () => {});
    socket.on('data', data => {
      message += data.toString();
      if (!received && message === 'exited\n') { received = true; callback(); }
      else if (message.length > 32) socket.destroy();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  } catch (error) { server.close(); await rm(directory, { recursive: true, force: true }); throw error; }
  return {
    path,
    onExit(handler) { callback = handler; if (received) callback(); },
    acknowledge() { peer?.write('drained\n'); },
    async close() { peer?.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); },
  };
}
