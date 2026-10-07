import { helperPath, runCommand } from './process.js';

export interface BluetoothDevice { address: string; name: string; paired: boolean; connected: boolean }
export interface BluetoothPort {
  list(scan: boolean, signal: AbortSignal): Promise<BluetoothDevice[]>;
  pair(address: string, signal: AbortSignal): Promise<BluetoothDevice>;
  connect(address: string, signal: AbortSignal): Promise<BluetoothDevice>;
}
export function normalizeAddress(address: string): string { return address.toLowerCase().replace(/[:-]/g, ''); }
export function parseDevice(value: unknown): BluetoothDevice {
  const d = value as Partial<BluetoothDevice> | null;
  if (!d || typeof d.address !== 'string' || !/^([\da-f]{2}[:-]){5}[\da-f]{2}$/i.test(d.address) || typeof d.name !== 'string' || d.name.length > 512 || typeof d.paired !== 'boolean' || typeof d.connected !== 'boolean') throw new Error('Invalid Bluetooth device response.');
  return { address: d.address, name: d.name, paired: d.paired, connected: d.connected };
}
export function parseBluetoothResult(text: string): Record<string, unknown> {
  const r = JSON.parse(text) as Record<string, unknown>;
  if (!r || r.v !== 1 || typeof r.ok !== 'boolean') throw new Error('Invalid Bluetooth helper response.');
  if (!r.ok) throw new Error(typeof r.message === 'string' ? r.message.slice(0, 1024) : 'Bluetooth operation failed.');
  return r;
}
export class NativeBluetooth implements BluetoothPort {
  constructor(private platform = process.platform, private runner = runCommand) {}
  private async call(args: string[], signal: AbortSignal): Promise<Record<string, unknown>> {
    if (this.platform !== 'darwin') throw new Error('Built-in Bluetooth pairing currently supports macOS. Choose USB or configure later on this platform.');
    const result = await this.runner(helperPath('padcode-bluetooth'), args, { signal, timeout: args[0] === 'pair' ? 45000 : 25000 });
    const parsed = parseBluetoothResult(result.stdout);
    if (result.code !== 0) throw new Error('Bluetooth helper exited unsuccessfully.');
    return parsed;
  }
  async list(scan: boolean, signal: AbortSignal): Promise<BluetoothDevice[]> {
    const result = await this.call([scan ? 'scan' : 'status'], signal);
    if (!Array.isArray(result.devices) || result.devices.length > 256) throw new Error('Invalid Bluetooth device list.');
    return result.devices.map(parseDevice).sort((a, b) => Number(/dualshock|wireless controller/i.test(b.name)) - Number(/dualshock|wireless controller/i.test(a.name)));
  }
  private async deviceCall(action: string, address: string, signal: AbortSignal): Promise<BluetoothDevice> {
    if (!/^([\da-f]{2}[:-]){5}[\da-f]{2}$/i.test(address)) throw new Error('Invalid Bluetooth address.');
    const device = parseDevice((await this.call([action, address], signal)).device);
    if (normalizeAddress(device.address) !== normalizeAddress(address)) throw new Error('Bluetooth helper returned a different device.');
    if (action === 'pair' && !device.paired) throw new Error('Pairing is not complete.');
    if (action === 'connect' && !device.connected) throw new Error('Connection is not complete.');
    return device;
  }
  pair(address: string, signal: AbortSignal): Promise<BluetoothDevice> { return this.deviceCall('pair', address, signal); }
  connect(address: string, signal: AbortSignal): Promise<BluetoothDevice> { return this.deviceCall('connect', address, signal); }
}
