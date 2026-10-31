import type { DeviceEvent, Status } from '../types';

export interface Change {
  id: string;
  status: Status;
}

// Recording changes refresh the page; device events only show a pop-up.
export type LiveEvent = { type: 'recording'; change: Change } | { type: 'device'; device: DeviceEvent };

type Listener = (event: LiveEvent) => void;

// Every open dashboard tab is a listener. On globalThis so the upload route,
// the ingest queue and the stream route all share one set.
const g = globalThis as unknown as { __live?: Set<Listener> };
const listeners = (g.__live ??= new Set());

function emit(event: LiveEvent) {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      listeners.delete(fn); // a closed stream; drop it
    }
  }
}

export const publish = (change: Change) => emit({ type: 'recording', change });
export const publishDevice = (device: DeviceEvent) => emit({ type: 'device', device });

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
