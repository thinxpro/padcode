import { normalizeAddress, type BluetoothDevice, type BluetoothPort } from './bluetooth.js';

export interface PickerDevice extends BluetoothDevice {
  source: 'known' | 'nearby' | 'known + nearby';
  cached: boolean;
}
export function mergeDeviceChoices(known: BluetoothDevice[], nearby: BluetoothDevice[], cached = false): PickerDevice[] {
  const merged = new Map<string, PickerDevice>();
  for (const device of nearby) merged.set(normalizeAddress(device.address), { ...device, source: 'nearby', cached: false });
  for (const device of known) {
    const key = normalizeAddress(device.address), discovered = merged.get(key);
    if (cached && discovered) {
      merged.set(key, { ...discovered, source: 'known + nearby' });
    } else {
      merged.set(key, { ...device,
        name: (!device.name || device.name === 'Unnamed Bluetooth device') && discovered ? discovered.name : device.name,
        connected: cached ? false : device.connected,
        source: discovered ? 'known + nearby' : 'known', cached });
    }
  }
  return [...merged.values()].sort((a, b) => Number(b.connected) - Number(a.connected) ||
    Number(/dualshock|wireless controller/i.test(b.name)) - Number(/dualshock|wireless controller/i.test(a.name)));
}
export async function scanDeviceChoices(bluetooth: BluetoothPort, previous: PickerDevice[], signal: AbortSignal, refreshing = () => {}): Promise<{ devices: PickerDevice[]; warnings: string[]; discovered: number | undefined }> {
  signal.throwIfAborted();
  const warnings: string[] = [];
  let nearby: BluetoothDevice[] = [], discovered: number | undefined;
  try {
    nearby = await bluetooth.list(true, signal);
    discovered = nearby.length;
    if (bluetooth.scanWarning) warnings.push(bluetooth.scanWarning);
  } catch (error) {
    signal.throwIfAborted();
    warnings.push(`SCAN NOT COMPLETED: ${(error as Error).message} Known devices remain available below.`);
  }
  signal.throwIfAborted(); refreshing();
  let known: BluetoothDevice[], cached = false;
  try { known = await bluetooth.list(false, signal); }
  catch (error) {
    signal.throwIfAborted(); cached = true;
    known = previous.filter(device => device.source !== 'nearby');
    warnings.push(`STATUS NOT REFRESHED: ${(error as Error).message} Previously known devices are cached; connection will be checked when selected.`);
  }
  signal.throwIfAborted();
  return { devices: mergeDeviceChoices(known, nearby, cached), warnings, discovered };
}
